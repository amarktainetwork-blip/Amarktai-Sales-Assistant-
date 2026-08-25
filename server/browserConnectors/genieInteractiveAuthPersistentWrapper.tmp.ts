export * from "./genieInteractiveAuthCore";

import type { AdapterConnection } from "../crm/types";
import {
  isBrowserSessionPackage,
  type BrowserSessionPackage,
} from "./browserSession";
import {
  claimPersistentGenieProfile,
  persistentProfileBindingFor,
} from "./geniePersistentProfile";
import {
  beginGenieInteractiveAuthentication as beginCore,
  completeGenieInteractiveAuthentication as completeCore,
  type GenieAuthenticationResult,
  type GenieBrowserSecret,
  type PendingGenieInteractiveAuth,
} from "./genieInteractiveAuthCore";

function persistentBootstrapSession(
  connection: AdapterConnection
): BrowserSessionPackage {
  if (!connection.baseUrl)
    throw new Error(
      "GENIE_LOGIN_URL_REQUIRED: Save the authorised Genie sign-in URL before connecting."
    );
  const origin = new URL(connection.baseUrl).origin;
  return {
    kind: "amarktai.browser-session",
    version: 2,
    storageState: { cookies: [], origins: [] },
    sessionStorageByOrigin: { [origin]: {} },
    authorisedOrigins: [origin],
    capturedAt: new Date().toISOString(),
    authenticatedUrl: connection.baseUrl,
    persistenceMode: "persistent_cdp",
    persistentProfileBinding: persistentProfileBindingFor(connection),
  };
}

export async function beginGenieInteractiveAuthentication(input: {
  connection: AdapterConnection;
  secret: GenieBrowserSecret;
}): Promise<GenieAuthenticationResult> {
  await claimPersistentGenieProfile(input.connection);
  const current = input.secret.browserSession;
  const persistent =
    current &&
    isBrowserSessionPackage(current) &&
    current.persistenceMode === "persistent_cdp"
      ? current
      : persistentBootstrapSession(input.connection);
  return beginCore({
    ...input,
    secret: { ...input.secret, browserSession: persistent },
  });
}

export async function completeGenieInteractiveAuthentication(input: {
  connection: AdapterConnection;
  pending: PendingGenieInteractiveAuth;
  code: unknown;
}) {
  await claimPersistentGenieProfile(input.connection);
  return completeCore(input);
}
