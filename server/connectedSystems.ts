import { and, desc, eq } from "drizzle-orm";
import { authorisedDomains, connectedSystems, connectionSecrets, connectorVerificationRuns } from "../drizzle/schema";
import { getDb } from "./db";
import { canManageOrganisationForUser, requireOrganisationMembership } from "./organisation";
import { decryptConnectionSecret, encryptConnectionSecret } from "./security/connectionSecrets";
import { assertPublicHttpUrl } from "./security/networkPolicy";
import type { AdapterConnection, ConnectionSecretPayload, ConnectionTest, CrmProvider } from "./crm/types";

const connectionMethods = ["oauth", "browser", "sidecar", "custom_adapter", "import"] as const;
type ConnectionMethod = (typeof connectionMethods)[number];
const privateExecutionKey = /(?:password|secret|token|cookie|authorization|credential|storageState|browserProfile|authenticated|session)/i;
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

export function sanitizeConnectedSystemForApi<T extends Record<string, unknown>>(system: T): T {
  const sanitize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sanitize);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !privateExecutionKey.test(key)).map(([key, nested]) => [key, sanitize(nested)]));
  };
  return { ...system, configuration: sanitize(system.configuration || {}) } as T;
}

function hostnameFromUrl(baseUrl?: string | null) {
  if (!baseUrl) return null;
  const parsed = new URL(baseUrl);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("Connected systems must use an HTTP(S) URL.");
  return parsed.hostname.toLowerCase();
}

function toAdapterConnection(connection: typeof connectedSystems.$inferSelect): AdapterConnection {
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

export async function listConnectedSystemsForUser(userId: number, organisationId: number) {
  await requireOrganisationMembership(userId, organisationId);
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const systems = await db.select().from(connectedSystems).where(eq(connectedSystems.organisationId, organisationId)).orderBy(desc(connectedSystems.updatedAt));
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
  const membership = await requireOrganisationMembership(input.userId, input.organisationId);
  if (!(await canManageOrganisationForUser(input.userId, membership.role))) throw new Error("Only organisation owners, managers, and platform owners can add connected systems.");
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const result = await db.insert(connectedSystems).values({
    organisationId: input.organisationId,
    provider: input.provider,
    displayName: input.displayName,
    baseUrl: input.baseUrl ?? null,
    connectionMethod: input.connectionMethod,
    status: "disconnected",
    allowedReadCapabilities: input.allowedReadCapabilities,
    allowedWriteCapabilities: input.allowedWriteCapabilities,
    verifiedCapabilities: [],
    scopes: [],
    configuration: { configuredHostname: hostnameFromUrl(input.baseUrl) },
  });
  return Number(result[0].insertId);
}

export async function getConnectedSystemForUser(userId: number, organisationId: number, connectedSystemId: number) {
  await requireOrganisationMembership(userId, organisationId);
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const result = await db.select().from(connectedSystems).where(and(eq(connectedSystems.id, connectedSystemId), eq(connectedSystems.organisationId, organisationId))).limit(1);
  if (!result[0]) throw new Error("Connected system was not found in this organisation.");
  return result[0];
}

export async function markConnectionAuthenticationExpired(input: { organisationId: number; connectedSystemId: number; summary: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  await db.update(connectedSystems).set({ status: "authentication_expired", lastHealthCheckAt: new Date(), lastHealthSummary: input.summary.slice(0, 2_000) }).where(and(
    eq(connectedSystems.id, input.connectedSystemId),
    eq(connectedSystems.organisationId, input.organisationId)
  ));
}

export async function addAuthorisedDomain(input: { userId: number; organisationId: number; connectedSystemId: number; hostname: string; allowedPaths: string[] }) {
  const membership = await requireOrganisationMembership(input.userId, input.organisationId);
  if (!(await canManageOrganisationForUser(input.userId, membership.role))) throw new Error("Only organisation owners, managers, and platform owners can approve domains.");
  const system = await getConnectedSystemForUser(input.userId, input.organisationId, input.connectedSystemId);
  const hostname = input.hostname.trim().toLowerCase();
  if (!/^[a-z0-9.-]{1,253}$/i.test(hostname) || hostname.includes("..")) throw new Error("Enter a valid authorised business hostname.");
  const allowedPaths = input.allowedPaths.map(path => path.trim()).filter(Boolean);
  if (allowedPaths.some(path => !path.startsWith("/") || path.includes("//"))) throw new Error("Authorised paths must be absolute path prefixes.");
  await assertPublicHttpUrl(`https://${hostname}${allowedPaths[0] || "/"}`);
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  await db.insert(authorisedDomains).values({ organisationId: input.organisationId, connectedSystemId: system.id, hostname, allowedPaths, status: "verified", verifiedAt: new Date() }).onDuplicateKeyUpdate({ set: { allowedPaths, status: "verified", verifiedAt: new Date() } });
}

export async function isAuthorisedDomain(input: { organisationId: number; hostname: string; pathname: string; connectedSystemId?: number }) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const conditions = [eq(authorisedDomains.organisationId, input.organisationId), eq(authorisedDomains.hostname, input.hostname.toLowerCase()), eq(authorisedDomains.status, "verified")];
  if (input.connectedSystemId) conditions.push(eq(authorisedDomains.connectedSystemId, input.connectedSystemId));
  const entries = await db.select().from(authorisedDomains).where(and(...conditions));
  return entries.some(entry => entry.allowedPaths.length === 0 || entry.allowedPaths.some(prefix => input.pathname.startsWith(prefix)));
}

export async function assertAuthorisedConnectionUrl(input: { organisationId: number; connectedSystemId: number; rawUrl: string }) {
  const url = await assertPublicHttpUrl(input.rawUrl);
  const allowed = await isAuthorisedDomain({ organisationId: input.organisationId, connectedSystemId: input.connectedSystemId, hostname: url.hostname, pathname: url.pathname || "/" });
  if (!allowed) throw new Error("Browser navigation is outside this connected system's authorised business domain/path.");
  return url;
}

export async function saveConnectionSecret(input: { userId: number; organisationId: number; connectedSystemId: number; secretKind: string; secret: ConnectionSecretPayload }) {
  const membership = await requireOrganisationMembership(input.userId, input.organisationId);
  if (!(await canManageOrganisationForUser(input.userId, membership.role))) throw new Error("Only organisation owners, managers, and platform owners can manage connection credentials.");
  await getConnectedSystemForUser(input.userId, input.organisationId, input.connectedSystemId);
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const encrypted = encryptConnectionSecret(input.secret);
  await db.insert(connectionSecrets).values({ connectedSystemId: input.connectedSystemId, secretKind: input.secretKind, ...encrypted, expiresAt: input.secret.expiresAt ? new Date(input.secret.expiresAt) : null }).onDuplicateKeyUpdate({ set: { ...encrypted, expiresAt: input.secret.expiresAt ? new Date(input.secret.expiresAt) : null } });
}

export async function loadConnectionSecret(input: { organisationId: number; connectedSystemId: number; secretKind: string }): Promise<ConnectionSecretPayload | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const rows = await db
    .select({ secret: connectionSecrets })
    .from(connectionSecrets)
    .innerJoin(connectedSystems, eq(connectionSecrets.connectedSystemId, connectedSystems.id))
    .where(and(eq(connectedSystems.organisationId, input.organisationId), eq(connectionSecrets.connectedSystemId, input.connectedSystemId), eq(connectionSecrets.secretKind, input.secretKind)))
    .limit(1);
  const secret = rows[0]?.secret;
  if (!secret) return undefined;
  return decryptConnectionSecret<ConnectionSecretPayload>(secret);
}

/** Only this backend service is permitted to transition a system into ready. */
export async function recordConnectionVerification(input: { organisationId: number; connectedSystemId: number; correlationId: string; test: ConnectionTest }) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const system = (await db.select().from(connectedSystems).where(and(eq(connectedSystems.id, input.connectedSystemId), eq(connectedSystems.organisationId, input.organisationId))).limit(1))[0];
  if (!system) throw new Error("Connected system was not found in this organisation.");
  const verifiedCapabilities = input.test.capabilities.filter(result => result.available).map(result => result.capability);
  const status = input.test.status === "ready" ? "ready" : input.test.status === "limited" ? "limited_permissions" : "needs_attention" as const;
  await db.transaction(async tx => {
    await tx.insert(connectorVerificationRuns).values({ connectedSystemId: system.id, correlationId: input.correlationId, status: input.test.status, capabilities: Object.fromEntries(input.test.capabilities.map(capability => [capability.capability, capability.available])), summary: input.test.summary, evidence: { operations: input.test.evidence.map(item => ({ ...item, providerResult: item.providerResult ? sanitizeVerificationProviderResult(item.providerResult) : undefined })) }, completedAt: new Date() });
    await tx.update(connectedSystems).set({ status, verifiedCapabilities, accountExternalId: input.test.accountExternalId ?? system.accountExternalId, scopes: input.test.scopes ?? system.scopes, lastHealthCheckAt: new Date(), lastHealthSummary: input.test.summary, readyAt: input.test.status === "ready" ? new Date() : null }).where(eq(connectedSystems.id, system.id));
  });
  return { status, verifiedCapabilities };
}

export { toAdapterConnection };
