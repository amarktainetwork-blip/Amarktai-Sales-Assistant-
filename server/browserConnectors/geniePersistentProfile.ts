import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright-core";
import type { AdapterConnection } from "../crm/types";

const PROFILE_BINDING_VERSION = 1;
const DEFAULT_BINDING_PATH =
  "/app/data/connector-evidence/.genie-persistent-profile-owner.json";

type PersistentProfileBinding = {
  version: typeof PROFILE_BINDING_VERSION;
  organisationId: number;
  connectedSystemId: number;
};

function bindingFor(connection: AdapterConnection): PersistentProfileBinding {
  return {
    version: PROFILE_BINDING_VERSION,
    organisationId: connection.organisationId,
    connectedSystemId: connection.id,
  };
}

function bindingPath() {
  return (
    process.env.GENIE_PERSISTENT_PROFILE_BINDING_PATH?.trim() ||
    DEFAULT_BINDING_PATH
  );
}

function sameBinding(
  actual: PersistentProfileBinding,
  expected: PersistentProfileBinding
) {
  return (
    actual.version === expected.version &&
    actual.organisationId === expected.organisationId &&
    actual.connectedSystemId === expected.connectedSystemId
  );
}

async function readBinding(path: string) {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as Partial<PersistentProfileBinding>;
  if (
    parsed.version !== PROFILE_BINDING_VERSION ||
    !Number.isInteger(parsed.organisationId) ||
    !Number.isInteger(parsed.connectedSystemId)
  )
    throw new Error(
      "GENIE_PERSISTENT_PROFILE_BINDING_INVALID: The persistent Genie browser profile owner file is invalid. An operator must inspect it before Genie can continue."
    );
  return parsed as PersistentProfileBinding;
}

/**
 * A Chromium user-data directory is a durable browser identity, not a portable
 * session token. Until the browser runtime is sharded into one profile/process
 * per CRM connection, the single profile in this deployment may be owned by
 * exactly one Genie connected system. This prevents cross-organisation session
 * reuse while still allowing the production pilot to use Genie's trusted
 * browser/device state correctly.
 */
export async function claimPersistentGenieProfile(
  connection: AdapterConnection
) {
  const path = bindingPath();
  const expected = bindingFor(connection);
  await mkdir(dirname(path), { recursive: true });

  try {
    const current = await readBinding(path);
    if (!sameBinding(current, expected))
      throw new Error(
        "GENIE_PERSISTENT_PROFILE_IN_USE: This deployment's trusted Genie browser profile is already bound to another connected system. It will not be shared."
      );
    return expected;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  try {
    await writeFile(path, JSON.stringify(expected), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    return expected;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const current = await readBinding(path);
    if (!sameBinding(current, expected))
      throw new Error(
        "GENIE_PERSISTENT_PROFILE_IN_USE: This deployment's trusted Genie browser profile is already bound to another connected system. It will not be shared."
      );
    return expected;
  }
}

export async function getPersistentGenieContext(input: {
  browser: Browser;
  connection: AdapterConnection;
}): Promise<BrowserContext> {
  await claimPersistentGenieProfile(input.connection);
  const contexts = input.browser.contexts();
  if (contexts.length !== 1)
    throw new Error(
      `GENIE_PERSISTENT_PROFILE_UNAVAILABLE: Expected exactly one persistent Chromium context, found ${contexts.length}.`
    );
  return contexts[0];
}

export async function openPersistentGeniePage(input: {
  browser: Browser;
  connection: AdapterConnection;
}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await getPersistentGenieContext(input);
  return { context, page: await context.newPage() };
}

export async function closePersistentGeniePage(page: Page) {
  if (!page.isClosed()) await page.close().catch(() => undefined);
}
