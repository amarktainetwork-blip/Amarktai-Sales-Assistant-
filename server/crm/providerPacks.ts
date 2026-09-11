import { createHash } from "node:crypto";
import type { SavedBrowserScript } from "../browserConnectors/scriptEngine";
import type { BrowserProfile } from "../browserConnectors/browserCrmAdapter";

/** Reusable provider structure only: never tenant IDs, credentials or customer values. */
export const GENIE_PROVIDER_PACK_VERSION = "genie-2026.09.11.1";

// The current Genie/HighLevel contacts workspace no longer uses the old
// Tabulator row structure. Contact-detail links are the durable record identity:
// /v2/location/<location>/contacts/detail/<contact>. Keep the legacy class in
// the selector so older Genie workspaces continue to work during rollout.
const GENIE_CONTACT_RECORD_LINK =
  'a[href*="/contacts/detail/"], a.contact-name-link';
const GENIE_CONTACT_SEARCH_INPUT =
  '#list-view-record-search, input[placeholder*="Search Contacts" i]';

const scripts: BrowserProfile["scripts"] = {
  genie_contact_sync: {
    steps: [
      { action: "click", selector: "#sb_contacts" },
      {
        action: "expect_visible",
        selector: GENIE_CONTACT_RECORD_LINK,
      },
      {
        action: "read_rows",
        selector: GENIE_CONTACT_RECORD_LINK,
        key: "records",
        fields: {
          externalId: { attribute: "href" },
          name: {},
        },
      },
    ],
  },
  genie_contact_search: {
    steps: [
      { action: "click", selector: "#sb_contacts" },
      { action: "expect_visible", selector: GENIE_CONTACT_SEARCH_INPUT },
      {
        action: "fill",
        selector: GENIE_CONTACT_SEARCH_INPUT,
        value: "{{query}}",
      },
      { action: "press", selector: GENIE_CONTACT_SEARCH_INPUT, value: "Enter" },
      {
        action: "expect_visible",
        selector: GENIE_CONTACT_RECORD_LINK,
      },
      {
        action: "read_rows",
        selector: GENIE_CONTACT_RECORD_LINK,
        key: "records",
        fields: {
          externalId: { attribute: "href" },
          name: {},
        },
      },
    ],
  },
  genie_contact_read: {
    steps: [
      { action: "goto", value: "{{externalId}}" },
      {
        action: "expect_visible",
        selector: '[id="contact.first_name"] input',
      },
      {
        action: "read_rows",
        selector: "body",
        key: "records",
        fields: {
          firstName: {
            selector: '[id="contact.first_name"] input',
            attribute: "value",
          },
          lastName: {
            selector: '[id="contact.last_name"] input',
            attribute: "value",
          },
          email: {
            selector: '[id="contact.email"] input',
            attribute: "value",
          },
          phone: {
            selector: '[id="contact.phone"] input[type="tel"]',
            attribute: "value",
          },
          ownerExternalId: { selector: "#owner-dropdown-trigger" },
        },
      },
    ],
  },
};

export const GENIE_PROVIDER_PACK: Pick<
  BrowserProfile,
  "scripts" | "operationDefinitions" | "resultKeys"
> = {
  scripts,
  resultKeys: {
    syncContacts: "records",
    searchContacts: "records",
    getContact: "records",
  },
  operationDefinitions: {
    "contact.sync": {
      definition: {
        mode: "read",
        executeScript: "genie_contact_sync",
        resultKey: "records",
      },
      prerequisites: {
        providerPack: "genie",
        providerPackVersion: GENIE_PROVIDER_PACK_VERSION,
        verificationInputRole: "contact_catalogue_seed",
      },
    },
    "contact.search": {
      definition: {
        mode: "read",
        executeScript: "genie_contact_search",
        resultKey: "records",
      },
      prerequisites: {
        providerPack: "genie",
        providerPackVersion: GENIE_PROVIDER_PACK_VERSION,
        verificationInputRole: "derived_contact_query",
      },
    },
    "contact.read": {
      definition: {
        mode: "read",
        executeScript: "genie_contact_read",
        resultKey: "records",
      },
      prerequisites: {
        providerPack: "genie",
        providerPackVersion: GENIE_PROVIDER_PACK_VERSION,
        verificationInputRole: "derived_contact_external_id",
      },
    },
  },
};

export function providerPackFingerprint() {
  return createHash("sha256")
    .update(JSON.stringify(GENIE_PROVIDER_PACK))
    .digest("hex");
}

/**
 * Validate that the observed Genie sidebar control really points at Contacts,
 * but preserve the in-app click. Some Genie/HighLevel workspaces keep auth and
 * workspace state in the active SPA tab; replacing the click with a direct
 * navigation can load an unauthenticated/empty shell and make a valid selector
 * look like drift.
 */
export function bindGenieContactNavigation(
  script: SavedBrowserScript,
  snapshot: unknown
): SavedBrowserScript {
  if (
    script.steps[0]?.action !== "click" ||
    script.steps[0]?.selector !== "#sb_contacts"
  )
    return script;
  const controls =
    snapshot &&
    typeof snapshot === "object" &&
    "controls" in snapshot &&
    Array.isArray(snapshot.controls)
      ? snapshot.controls
      : [];
  const hrefs = Array.from(
    new Set(
      controls
        .filter(
          (item: any) =>
            item?.selector === "#sb_contacts" && typeof item.href === "string"
        )
        .map((item: any) => item.href as string)
    )
  );
  if (hrefs.length !== 1)
    throw new Error("GENIE_CONTACT_NAVIGATION_NOT_CAPTURED");
  const url = new URL(hrefs[0]);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/\/contacts\//.test(url.pathname)
  )
    throw new Error("GENIE_CONTACT_NAVIGATION_INVALID");
  return script;
}
