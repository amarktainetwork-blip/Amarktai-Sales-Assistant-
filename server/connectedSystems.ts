import { and, desc, eq } from "drizzle-orm";
import {
  authorisedDomains,
  connectedSystems,
  connectionSecrets,
  connectorVerificationRuns,
  crmCommissioningJobs,
} from "../drizzle/schema";
import { getDb, recordAudit } from "./db";
import {
  canManageOrganisationForUser,
  requireOrganisationMembership,
} from "./organisation";
import {
  decryptConnectionSecret,
  encryptConnectionSecret,
} from "./security/connectionSecrets";
import { assertPublicHttpUrl } from "./security/networkPolicy";
import type {
  AdapterConnection,
  ConnectionSecretPayload,
  ConnectionTest,
  CrmProvider,
} from "./crm/types";
import { crmBrowserPreset } from "./browserConnectors/crmBrowserPresets";

const connectionMethods = [
  "oauth",
  "browser",
  "sidecar",
  "custom_adapter",
  "import",
] as const;
type ConnectionMethod = (typeof connectionMethods)[number];
type ConnectedSystemRow = typeof connectedSystems.$inferSelect;
type Db = Exclude<Awaited<ReturnType<typeof getDb>>, null | undefined>;

const privateExecutionKey =
  /(?:password|secret|token|cookie|authorization|credential|storageState|browserProfile|authenticated|session)/i;
const safeVerificationEvidenceKeys = new Set([
  "cdpReachable",
  "authorisedDestinationReachable",
  "perConnectionCredentialsAvailable",
  "approvedSessionAvailable",
  "authenticationConfirmed",
  "authenticatedHostname",
  "learnedOperationReadinessInspected",
  "configuredOperations",
]);

const connectionStatusRank: Record<ConnectedSystemRow["status"], number> = {
  ready: 90,
  limited_permissions: 80,
  testing: 70,
  connecting: 60,
  needs_attention: 50,
  authentication_expired: 40,
  paused: 30,
  disconnected: 20,
  error: 10,
};

/**
 * A browser CRM has a deliberate commissioning state between being configured
 * and being verified. Marking that state as disconnected caused onboarding to
 * block the exact /crm/:id page required for sign-in, creating a setup loop.
 * Manual disconnect remains disconnected; ready is still verification-only.
 */
export function connectionStatusWhenStarting(input: {
  connectionMethod: ConnectionMethod;
  currentStatus?: ConnectedSystemRow["status"];
}): ConnectedSystemRow["status"] {
  if (input.connectionMethod !== "browser")
    return input.currentStatus ?? "disconnected";
  if (
    input.currentStatus &&
    input.currentStatus !== "disconnected" &&
    input.currentStatus !== "error"
  )
    return input.currentStatus;
  return "connecting";
}

function configurationRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isRetired(system: Pick<ConnectedSystemRow, "configuration">) {
  return typeof configurationRecord(system.configuration).retiredAt === "string";
}

function normalizedOrigin(baseUrl?: string | null) {
  if (!baseUrl) return null;
  const parsed = new URL(baseUrl);
  if (!/^https?:$/.test(parsed.protocol))
    throw new Error("Connected systems must use an HTTP(S) URL.");
  const defaultPort =
    (parsed.protocol === "https:" && parsed.port === "443") ||
    (parsed.protocol === "http:" && parsed.port === "80");
  const port = parsed.port && !defaultPort ? `:${parsed.port}` : "";
  return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${port}`;
}

function hostnameFromUrl(baseUrl?: string | null) {
  const origin = normalizedOrigin(baseUrl);
  return origin ? new URL(origin).hostname.toLowerCase() : null;
}

/** Stable product identity used to prevent duplicate CRM cards/rows. */
export function canonicalConnectionIdentity(input: {
  provider: string;
  baseUrl?: string | null;
  connectionMethod: string;
}) {
  const origin = normalizedOrigin(input.baseUrl);
  return origin
    ? `${input.provider.trim().toLowerCase()}|${origin}`
    : `${input.provider.trim().toLowerCase()}|${input.connectionMethod}`;
}

function canonicalRow(rows: ConnectedSystemRow[]) {
  return [...rows].sort((left, right) => {
    const status = connectionStatusRank[right.status] - connectionStatusRank[left.status];
    if (status) return status;
    const ready = Number(Boolean(right.readyAt)) - Number(Boolean(left.readyAt));
    if (ready) return ready;
    return right.updatedAt.getTime() - left.updatedAt.getTime();
  })[0];
}

/**
 * Existing legacy duplicates are kept in storage so CRM history is never
 * destroyed, but only one canonical active connection is exposed to product UI.
 */
export function selectCanonicalConnectedSystems(rows: ConnectedSystemRow[]) {
  const groups = new Map<string, ConnectedSystemRow[]>();
  for (const row of rows) {
    if (isRetired(row)) continue;
    const identity = canonicalConnectionIdentity(row);
    const group = groups.get(identity) || [];
    group.push(row);
    groups.set(identity, group);
  }
  return Array.from(groups.values())
    .map(group => canonicalRow(group))
    .filter((row): row is ConnectedSystemRow => Boolean(row))
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
}

export function sanitizeVerificationProviderResult(
  value: Record<string, unknown>
) {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => safeVerificationEvidenceKeys.has(key))
      .map(([key, nested]) => [
        key,
        Array.isArray(nested)
          ? nested.filter(item => typeof item === "string").slice(0, 100)
          : typeof nested === "string"
            ? nested.slice(0, 500)
            : typeof nested === "boolean" || typeof nested === "number"
              ? nested
              : undefined,
      ])
      .filter(([, nested]) => nested !== undefined)
  );
}

export function sanitizeConnectedSystemForApi<
  T extends Record<string, unknown>,
>(system: T): T {
  const sanitize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sanitize);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !privateExecutionKey.test(key))
        .map(([key, nested]) => [key, sanitize(nested)])
    );
  };
  return {
    ...system,
    configuration: sanitize(system.configuration || {}),
  } as T;
}

function toAdapterConnection(connection: ConnectedSystemRow): AdapterConnection {
  return {
    id: connection.id,
    organisationId: connection.organisationId,
    provider: connection.provider,
    displayName: connection.displayName,
    baseUrl: connection.baseUrl,
    connectionMethod: connection.connectionMethod,
    allowedReadCapabilities: connection.allowedReadCapabilities,
    allowedWriteCapabilities: connection.allowedWriteCapabilities,
    verifiedCapabilities: connection.verifiedCapabilities,
    scopes: connection.scopes,
    configuration: connection.configuration,
  };
}

async function ensureAuthorisedDomains(input: {
  db: Db;
  organisationId: number;
  connectedSystemId: number;
  provider: CrmProvider;
  startUrl?: URL;
}) {
  if (!input.startUrl) return;
  const preset = crmBrowserPreset(input.provider);
  const hostnames = Array.from(
    new Set([
      input.startUrl.hostname.toLowerCase(),
      ...preset.knownHostnames.map(hostname => hostname.toLowerCase()),
    ])
  );
  for (const hostname of hostnames)
    await input.db
      .insert(authorisedDomains)
      .values({
        organisationId: input.organisationId,
        connectedSystemId: input.connectedSystemId,
        hostname,
        allowedPaths: ["/"],
        status: "verified",
        verifiedAt: new Date(),
      })
      .onDuplicateKeyUpdate({
        set: {
          allowedPaths: ["/"],
          status: "verified",
          verifiedAt: new Date(),
        },
      });
}

async function organisationRows(db: Db, organisationId: number) {
  return db
    .select()
    .from(connectedSystems)
    .where(eq(connectedSystems.organisationId, organisationId))
    .orderBy(desc(connectedSystems.updatedAt));
}

export async function listConnectedSystemsForUser(
  userId: number,
  organisationId: number
) {
  await requireOrganisationMembership(userId, organisationId);
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const systems = selectCanonicalConnectedSystems(
    await organisationRows(db, organisationId)
  );
  return systems.map(system => sanitizeConnectedSystemForApi(system));
}

export async function createConnectedSystem(input: {
  userId: number;
  organisationId: number;
  provider: CrmProvider;
  displayName: string;
  baseUrl?: string | null;
  connectionMethod: ConnectionMethod;
  allowedReadCapabilities: string[];
  allowedWriteCapabilities: string[];
}) {
  const membership = await requireOrganisationMembership(
    input.userId,
    input.organisationId
  );
  if (!(await canManageOrganisationForUser(input.userId, membership.role)))
    throw new Error(
      "Only organisation owners, managers, and platform owners can add connected systems."
    );

  // Validate network policy before any database mutation. A rejected URL must
  // never leave behind a ghost connection row.
  const startUrl = input.baseUrl
    ? await assertPublicHttpUrl(input.baseUrl)
    : undefined;
  const identity = canonicalConnectionIdentity(input);
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const all = await organisationRows(db, input.organisationId);
  const matches = all.filter(
    row => canonicalConnectionIdentity(row) === identity
  );
  const active = canonicalRow(matches.filter(row => !isRetired(row)));

  if (active) {
    const allowedReadCapabilities = Array.from(
      new Set([...active.allowedReadCapabilities, ...input.allowedReadCapabilities])
    );
    const allowedWriteCapabilities = Array.from(
      new Set([...active.allowedWriteCapabilities, ...input.allowedWriteCapabilities])
    );
    await db
      .update(connectedSystems)
      .set({
        displayName: input.displayName,
        status: connectionStatusWhenStarting({
          connectionMethod: input.connectionMethod,
          currentStatus: active.status,
        }),
        allowedReadCapabilities,
        allowedWriteCapabilities,
      })
      .where(eq(connectedSystems.id, active.id));
    await ensureAuthorisedDomains({
      db,
      organisationId: input.organisationId,
      connectedSystemId: active.id,
      provider: input.provider,
      startUrl,
    });
    await recordAudit({
      userId: input.userId,
      organisationId: input.organisationId,
      eventType: "connected_system_reused",
      entityType: "connected_system",
      entityId: String(active.id),
      summary: `${input.displayName} was already connected, so Amarktai reused the existing CRM connection instead of creating a duplicate.`,
      metadata: { provider: input.provider, connectionMethod: input.connectionMethod },
    });
    return active.id;
  }

  const retired = canonicalRow(matches.filter(isRetired));
  if (retired) {
    const oldConfiguration = configurationRecord(retired.configuration);
    const {
      retiredAt: _retiredAt,
      retiredByUserId: _retiredByUserId,
      ...retainedConfiguration
    } = oldConfiguration;
    await db
      .update(connectedSystems)
      .set({
        provider: input.provider,
        displayName: input.displayName,
        baseUrl: input.baseUrl ?? null,
        connectionMethod: input.connectionMethod,
        status: connectionStatusWhenStarting({
          connectionMethod: input.connectionMethod,
        }),
        allowedReadCapabilities: input.allowedReadCapabilities,
        allowedWriteCapabilities: input.allowedWriteCapabilities,
        verifiedCapabilities: [],
        scopes: [],
        configuration: {
          ...retainedConfiguration,
          configuredHostname: hostnameFromUrl(input.baseUrl),
        },
        lastHealthCheckAt: null,
        lastHealthSummary: "CRM connection reactivated. Sign in to continue.",
        readyAt: null,
      })
      .where(eq(connectedSystems.id, retired.id));
    await ensureAuthorisedDomains({
      db,
      organisationId: input.organisationId,
      connectedSystemId: retired.id,
      provider: input.provider,
      startUrl,
    });
    await recordAudit({
      userId: input.userId,
      organisationId: input.organisationId,
      eventType: "connected_system_reactivated",
      entityType: "connected_system",
      entityId: String(retired.id),
      summary: `${input.displayName} was reconnected using its existing CRM history.`,
      metadata: { provider: input.provider, connectionMethod: input.connectionMethod },
    });
    return retired.id;
  }

  const result = await db.insert(connectedSystems).values({
    organisationId: input.organisationId,
    provider: input.provider,
    displayName: input.displayName,
    baseUrl: input.baseUrl ?? null,
    connectionMethod: input.connectionMethod,
    status: connectionStatusWhenStarting({
      connectionMethod: input.connectionMethod,
    }),
    allowedReadCapabilities: input.allowedReadCapabilities,
    allowedWriteCapabilities: input.allowedWriteCapabilities,
    verifiedCapabilities: [],
    scopes: [],
    configuration: { configuredHostname: hostnameFromUrl(input.baseUrl) },
  });
  const connectedSystemId = Number(result[0].insertId);
  await ensureAuthorisedDomains({
    db,
    organisationId: input.organisationId,
    connectedSystemId,
    provider: input.provider,
    startUrl,
  });
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "connected_system_created",
    entityType: "connected_system",
    entityId: String(connectedSystemId),
    summary: `${input.displayName} CRM connection was created.`,
    metadata: { provider: input.provider, connectionMethod: input.connectionMethod },
  });
  return connectedSystemId;
}

export async function getConnectedSystemForUser(
  userId: number,
  organisationId: number,
  connectedSystemId: number
) {
  await requireOrganisationMembership(userId, organisationId);
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const result = await db
    .select()
    .from(connectedSystems)
    .where(
      and(
        eq(connectedSystems.id, connectedSystemId),
        eq(connectedSystems.organisationId, organisationId)
      )
    )
    .limit(1);
  if (!result[0])
    throw new Error("Connected system was not found in this organisation.");
  return result[0];
}

export async function getConnectedSystemIdentityClusterForUser(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
}) {
  const target = await getConnectedSystemForUser(
    input.userId,
    input.organisationId,
    input.connectedSystemId
  );
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const identity = canonicalConnectionIdentity(target);
  return (await organisationRows(db, input.organisationId)).filter(
    row => canonicalConnectionIdentity(row) === identity && !isRetired(row)
  );
}

export async function disconnectConnectedSystem(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
}) {
  const membership = await requireOrganisationMembership(
    input.userId,
    input.organisationId
  );
  if (!(await canManageOrganisationForUser(input.userId, membership.role)))
    throw new Error(
      "Only organisation owners, managers, and platform owners can disconnect CRM systems."
    );
  const cluster = await getConnectedSystemIdentityClusterForUser(input);
  if (!cluster.length) return { retiredIds: [] as number[] };
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const retiredAt = new Date();
  const retiredIds = cluster.map(row => row.id);

  await db.transaction(async tx => {
    for (const system of cluster) {
      await tx
        .delete(connectionSecrets)
        .where(eq(connectionSecrets.connectedSystemId, system.id));
      await tx
        .update(authorisedDomains)
        .set({ status: "revoked" })
        .where(eq(authorisedDomains.connectedSystemId, system.id));
      await tx
        .update(crmCommissioningJobs)
        .set({
          status: "cancelled",
          cancelRequested: true,
          leaseExpiresAt: null,
          lastError: null,
        })
        .where(eq(crmCommissioningJobs.connectedSystemId, system.id));
      await tx
        .update(connectedSystems)
        .set({
          status: "disconnected",
          verifiedCapabilities: [],
          scopes: [],
          readyAt: null,
          lastHealthCheckAt: retiredAt,
          lastHealthSummary:
            "CRM disconnected. Authentication was removed; retained CRM history remains available for audit and reporting.",
          configuration: {
            ...configurationRecord(system.configuration),
            retiredAt: retiredAt.toISOString(),
            retiredByUserId: input.userId,
          },
        })
        .where(eq(connectedSystems.id, system.id));
    }
  });

  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "connected_system_disconnected",
    entityType: "connected_system",
    entityId: String(input.connectedSystemId),
    summary: `${cluster[0].displayName} was disconnected without deleting retained CRM history.`,
    metadata: {
      provider: cluster[0].provider,
      retiredConnectionIds: retiredIds,
      authenticationRemoved: true,
      crmHistoryDeleted: false,
    },
  });
  return { retiredIds };
}

export async function markConnectionAuthenticationExpired(input: {
  organisationId: number;
  connectedSystemId: number;
  summary: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  await db
    .update(connectedSystems)
    .set({
      status: "authentication_expired",
      lastHealthCheckAt: new Date(),
      lastHealthSummary: input.summary.slice(0, 2_000),
    })
    .where(
      and(
        eq(connectedSystems.id, input.connectedSystemId),
        eq(connectedSystems.organisationId, input.organisationId)
      )
    );
}

export async function addAuthorisedDomain(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
  hostname: string;
  allowedPaths: string[];
}) {
  const membership = await requireOrganisationMembership(
    input.userId,
    input.organisationId
  );
  if (!(await canManageOrganisationForUser(input.userId, membership.role)))
    throw new Error(
      "Only organisation owners, managers, and platform owners can approve domains."
    );
  const system = await getConnectedSystemForUser(
    input.userId,
    input.organisationId,
    input.connectedSystemId
  );
  const hostname = input.hostname.trim().toLowerCase();
  if (!/^[a-z0-9.-]{1,253}$/i.test(hostname) || hostname.includes(".."))
    throw new Error("Enter a valid authorised business hostname.");
  const allowedPaths = input.allowedPaths
    .map(path => path.trim())
    .filter(Boolean);
  if (allowedPaths.some(path => !path.startsWith("/") || path.includes("//")))
    throw new Error("Authorised paths must be absolute path prefixes.");
  await assertPublicHttpUrl(`https://${hostname}${allowedPaths[0] || "/"}`);
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  await db
    .insert(authorisedDomains)
    .values({
      organisationId: input.organisationId,
      connectedSystemId: system.id,
      hostname,
      allowedPaths,
      status: "verified",
      verifiedAt: new Date(),
    })
    .onDuplicateKeyUpdate({
      set: { allowedPaths, status: "verified", verifiedAt: new Date() },
    });
}

export async function isAuthorisedDomain(input: {
  organisationId: number;
  hostname: string;
  pathname: string;
  connectedSystemId?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const conditions = [
    eq(authorisedDomains.organisationId, input.organisationId),
    eq(authorisedDomains.hostname, input.hostname.toLowerCase()),
    eq(authorisedDomains.status, "verified"),
  ];
  if (input.connectedSystemId)
    conditions.push(
      eq(authorisedDomains.connectedSystemId, input.connectedSystemId)
    );
  const entries = await db
    .select()
    .from(authorisedDomains)
    .where(and(...conditions));
  return entries.some(
    entry =>
      entry.allowedPaths.length === 0 ||
      entry.allowedPaths.some(prefix => input.pathname.startsWith(prefix))
  );
}

export async function assertAuthorisedConnectionUrl(input: {
  organisationId: number;
  connectedSystemId: number;
  rawUrl: string;
}) {
  const url = await assertPublicHttpUrl(input.rawUrl);
  const allowed = await isAuthorisedDomain({
    organisationId: input.organisationId,
    connectedSystemId: input.connectedSystemId,
    hostname: url.hostname,
    pathname: url.pathname || "/",
  });
  if (!allowed)
    throw new Error(
      "Browser navigation is outside this connected system's authorised business domain/path."
    );
  return url;
}

function personalSecretKind(userId: number, secretKind: string) {
  const clean = secretKind.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 40);
  return `${clean}:user:${userId}`.slice(0, 80);
}

async function persistSecret(input: {
  connectedSystemId: number;
  secretKind: string;
  secret: ConnectionSecretPayload;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const encrypted = encryptConnectionSecret(input.secret);
  await db
    .insert(connectionSecrets)
    .values({
      connectedSystemId: input.connectedSystemId,
      secretKind: input.secretKind,
      ...encrypted,
      expiresAt: input.secret.expiresAt
        ? new Date(input.secret.expiresAt)
        : null,
    })
    .onDuplicateKeyUpdate({
      set: {
        ...encrypted,
        expiresAt: input.secret.expiresAt
          ? new Date(input.secret.expiresAt)
          : null,
      },
    });
}

export async function saveConnectionSecret(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
  secretKind: string;
  secret: ConnectionSecretPayload;
}) {
  const membership = await requireOrganisationMembership(
    input.userId,
    input.organisationId
  );
  if (!(await canManageOrganisationForUser(input.userId, membership.role)))
    throw new Error(
      "Only organisation owners, managers, and platform owners can manage shared connection credentials."
    );
  await getConnectedSystemForUser(
    input.userId,
    input.organisationId,
    input.connectedSystemId
  );
  await persistSecret({
    connectedSystemId: input.connectedSystemId,
    secretKind: input.secretKind,
    secret: input.secret,
  });
}

/**
 * Personal CRM credentials/session material. The shared connected-system row
 * defines the company CRM and verified capabilities; each user owns a separate
 * encrypted secret namespace for their own CRM login.
 */
export async function saveUserConnectionSecret(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
  secretKind: string;
  secret: ConnectionSecretPayload;
}) {
  await requireOrganisationMembership(input.userId, input.organisationId);
  await getConnectedSystemForUser(
    input.userId,
    input.organisationId,
    input.connectedSystemId
  );
  await persistSecret({
    connectedSystemId: input.connectedSystemId,
    secretKind: personalSecretKind(input.userId, input.secretKind),
    secret: input.secret,
  });
}

export async function loadConnectionSecret(input: {
  organisationId: number;
  connectedSystemId: number;
  secretKind: string;
}): Promise<ConnectionSecretPayload | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const system = (
    await db
      .select({ provider: connectedSystems.provider })
      .from(connectedSystems)
      .where(
        and(
          eq(connectedSystems.id, input.connectedSystemId),
          eq(connectedSystems.organisationId, input.organisationId)
        )
      )
      .limit(1)
  )[0];
  if (!system) return undefined;
  const rows = await db
    .select({ secret: connectionSecrets })
    .from(connectionSecrets)
    .innerJoin(
      connectedSystems,
      eq(connectionSecrets.connectedSystemId, connectedSystems.id)
    )
    .where(
      and(
        eq(connectedSystems.organisationId, input.organisationId),
        eq(connectionSecrets.connectedSystemId, input.connectedSystemId),
        eq(connectionSecrets.secretKind, input.secretKind)
      )
    )
    .limit(1);
  const secret = rows[0]?.secret;
  return secret
    ? decryptConnectionSecret<ConnectionSecretPayload>(secret)
    : undefined;
}

export async function loadUserConnectionSecret(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
  secretKind: string;
}): Promise<ConnectionSecretPayload | undefined> {
  await requireOrganisationMembership(input.userId, input.organisationId);
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const rows = await db
    .select({ secret: connectionSecrets })
    .from(connectionSecrets)
    .innerJoin(
      connectedSystems,
      eq(connectionSecrets.connectedSystemId, connectedSystems.id)
    )
    .where(
      and(
        eq(connectedSystems.organisationId, input.organisationId),
        eq(connectionSecrets.connectedSystemId, input.connectedSystemId),
        eq(
          connectionSecrets.secretKind,
          personalSecretKind(input.userId, input.secretKind)
        )
      )
    )
    .limit(1);
  const secret = rows[0]?.secret;
  return secret
    ? decryptConnectionSecret<ConnectionSecretPayload>(secret)
    : undefined;
}

export async function hasUserConnectionSecret(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
  secretKind: string;
}) {
  return Boolean(await loadUserConnectionSecret(input));
}

/** Only this backend service is permitted to transition a system into ready. */
export async function recordConnectionVerification(input: {
  organisationId: number;
  connectedSystemId: number;
  correlationId: string;
  test: ConnectionTest;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const system = (
    await db
      .select()
      .from(connectedSystems)
      .where(
        and(
          eq(connectedSystems.id, input.connectedSystemId),
          eq(connectedSystems.organisationId, input.organisationId)
        )
      )
      .limit(1)
  )[0];
  if (!system)
    throw new Error("Connected system was not found in this organisation.");
  const verifiedCapabilities = input.test.capabilities
    .filter(result => result.available)
    .map(result => result.capability);
  const status =
    input.test.status === "ready"
      ? "ready"
      : input.test.status === "limited"
        ? "limited_permissions"
        : ("needs_attention" as const);
  await db.transaction(async tx => {
    await tx.insert(connectorVerificationRuns).values({
      connectedSystemId: system.id,
      correlationId: input.correlationId,
      status: input.test.status,
      capabilities: Object.fromEntries(
        input.test.capabilities.map(capability => [
          capability.capability,
          capability.available,
        ])
      ),
      summary: input.test.summary,
      evidence: {
        operations: input.test.evidence.map(item => ({
          ...item,
          providerResult: item.providerResult
            ? sanitizeVerificationProviderResult(item.providerResult)
            : undefined,
        })),
      },
      completedAt: new Date(),
    });
    await tx
      .update(connectedSystems)
      .set({
        status,
        verifiedCapabilities,
        accountExternalId:
          input.test.accountExternalId ?? system.accountExternalId,
        scopes: input.test.scopes ?? system.scopes,
        lastHealthCheckAt: new Date(),
        lastHealthSummary: input.test.summary,
        readyAt: input.test.status === "ready" ? new Date() : null,
      })
      .where(eq(connectedSystems.id, system.id));
  });
  return { status, verifiedCapabilities };
}

export { toAdapterConnection };
