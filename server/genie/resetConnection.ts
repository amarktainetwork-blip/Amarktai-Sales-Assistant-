import { and, eq } from "drizzle-orm";
import { chromium, type Browser } from "playwright-core";
import { auditEntries, connectedSystems } from "../../drizzle/schema";
import { getDb } from "../db";
import { toAdapterConnection } from "../connectedSystems";
import {
  claimPersistentGenieProfile,
  persistentGenieProfileBindingMatches,
  persistentProfileBindingFor,
  readPersistentGenieProfileBinding,
  releasePersistentGenieProfile,
} from "../browserConnectors/geniePersistentProfile";
import { removeGeniePreOtpProof } from "./preOtpReadiness";

type GenieSystem = typeof connectedSystems.$inferSelect;

type ResetDependencies = {
  loadSystem(
    connectedSystemId: number,
    organisationId: number
  ): Promise<GenieSystem | undefined>;
  assertProfileOwnership?(system: GenieSystem): Promise<void>;
  browser(): Promise<Browser>;
  releaseProfile(system: GenieSystem): Promise<boolean>;
  restoreProfile(system: GenieSystem): Promise<unknown>;
  deleteConnectionAndAudit(input: {
    system: GenieSystem;
    userId: number;
    hostname: string;
  }): Promise<void>;
  removeReadinessProof?(
    organisationId: number,
    connectedSystemId: number
  ): Promise<void>;
};

let resetBrowser: Browser | undefined;
let resetBrowserConnecting: Promise<Browser> | undefined;

async function getResetBrowser() {
  if (resetBrowser?.isConnected()) return resetBrowser;
  if (resetBrowserConnecting) return resetBrowserConnecting;
  const endpoint = process.env.BROWSERLESS_WS_ENDPOINT?.trim();
  if (!endpoint)
    throw new Error(
      "GENIE_RESET_BROWSER_UNAVAILABLE: Chromium/CDP endpoint is not configured."
    );
  resetBrowserConnecting = chromium
    .connectOverCDP(endpoint, { timeout: 12_000 })
    .then(browser => {
      resetBrowser = browser;
      browser.on("disconnected", () => {
        if (resetBrowser === browser) resetBrowser = undefined;
      });
      return browser;
    })
    .finally(() => {
      resetBrowserConnecting = undefined;
    });
  return resetBrowserConnecting;
}

function sameHostname(rawUrl: string, hostname: string) {
  try {
    return new URL(rawUrl).hostname.toLowerCase() === hostname;
  } catch {
    return false;
  }
}

export async function clearGenieBrowserOriginState(input: {
  browser: Browser;
  baseUrl: string;
}) {
  const origin = new URL(input.baseUrl).origin;
  const hostname = new URL(origin).hostname.toLowerCase();
  const contexts = input.browser.contexts();
  if (contexts.length !== 1)
    throw new Error(
      `GENIE_RESET_BROWSER_UNAVAILABLE: Expected exactly one persistent Chromium context, found ${contexts.length}.`
    );
  const context = contexts[0];

  for (const page of context.pages()) {
    if (!page.isClosed() && sameHostname(page.url(), hostname))
      await page.close();
  }

  await context.clearCookies({ domain: hostname });
  await context.clearCookies({ domain: `.${hostname}` });

  const session = await input.browser.newBrowserCDPSession();
  try {
    const targets = (await session.send("Target.getTargets")) as {
      targetInfos?: Array<{ targetId: string; type: string; url: string }>;
    };
    for (const target of targets.targetInfos || []) {
      if (
        target.type !== "service_worker" ||
        !sameHostname(target.url, hostname)
      )
        continue;
      await session.send("Target.closeTarget", { targetId: target.targetId });
    }
    await session.send("Storage.clearDataForOrigin", {
      origin,
      storageTypes: "all",
    });
  } finally {
    await session.detach().catch(() => undefined);
  }

  return { origin, hostname };
}

export async function resetAndDeleteGenieConnection(
  input: {
    connectedSystemId: number;
    organisationId: number;
    confirmDelete: boolean;
    userId: number;
  },
  dependencies: ResetDependencies = productionResetDependencies
) {
  if (
    !Number.isInteger(input.connectedSystemId) ||
    input.connectedSystemId <= 0
  )
    throw new Error("GENIE_RESET_CONNECTION_ID_REQUIRED");
  if (!Number.isInteger(input.organisationId) || input.organisationId <= 0)
    throw new Error("GENIE_RESET_ORGANISATION_ID_REQUIRED");
  if (!Number.isInteger(input.userId) || input.userId <= 0)
    throw new Error("GENIE_RESET_USER_ID_REQUIRED");

  const system = await dependencies.loadSystem(
    input.connectedSystemId,
    input.organisationId
  );
  if (!system) throw new Error("GENIE_RESET_CONNECTION_NOT_FOUND");
  if (system.provider !== "genie")
    throw new Error(
      "GENIE_RESET_REFUSED: The selected connection is not Genie."
    );
  if (!system.baseUrl)
    throw new Error(
      "GENIE_RESET_REFUSED: The selected Genie connection has no base URL."
    );

  const preview = {
    connectedSystemId: system.id,
    organisationId: system.organisationId,
    provider: system.provider,
    displayName: system.displayName,
    status: system.status,
    hostname: new URL(system.baseUrl).hostname,
  };
  if (!input.confirmDelete) return { deleted: false as const, preview };

  await dependencies.assertProfileOwnership?.(system);
  const browser = await dependencies.browser();
  await clearGenieBrowserOriginState({ browser, baseUrl: system.baseUrl });
  await dependencies.removeReadinessProof?.(system.organisationId, system.id);
  const released = await dependencies.releaseProfile(system);
  try {
    await dependencies.deleteConnectionAndAudit({
      system,
      userId: input.userId,
      hostname: new URL(system.baseUrl).hostname,
    });
  } catch (error) {
    if (released)
      await dependencies.restoreProfile(system).catch(() => undefined);
    throw error;
  }

  return { deleted: true as const, preview };
}

const productionResetDependencies: ResetDependencies = {
  async loadSystem(connectedSystemId, organisationId) {
    const db = await getDb();
    if (!db) throw new Error("Database connection is unavailable.");
    return (
      await db
        .select()
        .from(connectedSystems)
        .where(
          and(
            eq(connectedSystems.id, connectedSystemId),
            eq(connectedSystems.organisationId, organisationId)
          )
        )
        .limit(1)
    )[0];
  },
  browser: getResetBrowser,
  async assertProfileOwnership(system) {
    const actual = await readPersistentGenieProfileBinding();
    if (
      actual &&
      !persistentGenieProfileBindingMatches(
        actual,
        persistentProfileBindingFor(toAdapterConnection(system))
      )
    )
      throw new Error("GENIE_PERSISTENT_PROFILE_RELEASE_BLOCKED");
  },
  releaseProfile: system =>
    releasePersistentGenieProfile(toAdapterConnection(system)),
  restoreProfile: system =>
    claimPersistentGenieProfile(toAdapterConnection(system)),
  removeReadinessProof: removeGeniePreOtpProof,
  async deleteConnectionAndAudit({ system, userId, hostname }) {
    const db = await getDb();
    if (!db) throw new Error("Database connection is unavailable.");
    await db.transaction(async tx => {
      await tx
        .delete(connectedSystems)
        .where(
          and(
            eq(connectedSystems.id, system.id),
            eq(connectedSystems.organisationId, system.organisationId)
          )
        );
      await tx.insert(auditEntries).values({
        userId,
        organisationId: system.organisationId,
        eventType: "genie_connection_fresh_reset",
        entityType: "connected_system",
        entityId: String(system.id),
        summary:
          "The selected Genie connection was removed for a clean start. Only its Amarktai connection state and saved Genie browser sign-in state were cleared; external Genie records and company knowledge were unchanged.",
        metadata: {
          deletedConnectedSystemId: system.id,
          hostname,
          externalCrmRecordsModified: false,
          companyProfileModified: false,
          websiteDiscoveriesModified: false,
          companyKnowledgeModified: false,
          usersModified: false,
        },
      });
    });
  },
};
