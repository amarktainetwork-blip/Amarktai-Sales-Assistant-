import { and, eq } from "drizzle-orm";
import { chromium, type Browser } from "playwright-core";
import { connectedSystems } from "../../drizzle/schema";
import { getDb, recordAudit } from "../db";
import { toAdapterConnection } from "../connectedSystems";
import { releasePersistentGenieProfile } from "../browserConnectors/geniePersistentProfile";

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
      await page.close().catch(() => undefined);
  }
  for (const worker of context.serviceWorkers()) {
    if (sameHostname(worker.url(), hostname))
      await worker.close().catch(() => undefined);
  }

  await context.clearCookies({
    domain: new RegExp(`(?:^|\\.)${hostname.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}$`, "i"),
  });

  const session = await input.browser.newBrowserCDPSession();
  try {
    await session.send("Storage.clearDataForOrigin", {
      origin,
      storageTypes: "all",
    });
  } finally {
    await session.detach().catch(() => undefined);
  }

  return { origin, hostname };
}

export async function resetAndDeleteGenieConnection(input: {
  connectedSystemId: number;
  confirmDelete: boolean;
  userId?: number;
}) {
  if (!Number.isInteger(input.connectedSystemId) || input.connectedSystemId <= 0)
    throw new Error("GENIE_RESET_CONNECTION_ID_REQUIRED");

  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const system = (
    await db
      .select()
      .from(connectedSystems)
      .where(eq(connectedSystems.id, input.connectedSystemId))
      .limit(1)
  )[0];
  if (!system) throw new Error("GENIE_RESET_CONNECTION_NOT_FOUND");
  if (system.provider !== "genie")
    throw new Error("GENIE_RESET_REFUSED: The selected connection is not Genie.");
  if (!system.baseUrl)
    throw new Error("GENIE_RESET_REFUSED: The selected Genie connection has no base URL.");

  const preview = {
    connectedSystemId: system.id,
    organisationId: system.organisationId,
    provider: system.provider,
    displayName: system.displayName,
    status: system.status,
    hostname: new URL(system.baseUrl).hostname,
  };
  if (!input.confirmDelete) return { deleted: false as const, preview };

  const endpoint = process.env.BROWSERLESS_WS_ENDPOINT?.trim();
  if (!endpoint)
    throw new Error("GENIE_RESET_BROWSER_UNAVAILABLE: Chromium/CDP endpoint is not configured.");

  const browser = await chromium.connectOverCDP(endpoint, { timeout: 12_000 });
  await clearGenieBrowserOriginState({ browser, baseUrl: system.baseUrl });
  await releasePersistentGenieProfile(toAdapterConnection(system));

  await db
    .delete(connectedSystems)
    .where(
      and(
        eq(connectedSystems.id, system.id),
        eq(connectedSystems.organisationId, system.organisationId)
      )
    );

  await recordAudit({
    userId: input.userId,
    organisationId: system.organisationId,
    eventType: "genie_connection_fresh_reset",
    entityType: "connected_system",
    entityId: String(system.id),
    summary:
      "The Genie connection was deliberately removed for a clean re-commissioning. Genie browser tabs, cookies, site storage and persistent profile ownership were cleared; unrelated workspace and company knowledge were preserved.",
    metadata: {
      deletedConnectedSystemId: system.id,
      hostname: new URL(system.baseUrl).hostname,
      externalCrmRecordsModified: false,
      companyKnowledgeModified: false,
    },
  });

  return { deleted: true as const, preview };
}
