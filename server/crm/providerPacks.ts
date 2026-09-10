import { createHash } from "node:crypto";
import type { SavedBrowserScript } from "../browserConnectors/scriptEngine";
import type { BrowserProfile } from "../browserConnectors/browserCrmAdapter";

/** Reusable provider structure only: never tenant IDs, credentials or customer values. */
export const GENIE_PROVIDER_PACK_VERSION = "genie-2026.09.08.1";

const scripts: BrowserProfile["scripts"] = {
  genie_contact_sync: {
    steps: [
      { action: "click", selector: "#sb_contacts" },
      {
        action: "expect_visible",
        selector: ".tabulator-row:not(.tabulator-headers)",
      },
      {
        action: "read_rows",
        selector: ".tabulator-row:not(.tabulator-headers)",
        key: "records",
        fields: {
          externalId: { selector: ".contact-name-link", attribute: "href" },
          name: { selector: ".contact-name-link" },
        },
      },
    ],
  },
  genie_contact_search: {
    steps: [
      { action: "click", selector: "#sb_contacts" },
      { action: "expect_visible", selector: "#list-view-record-search" },
      {
        action: "fill",
        selector: "#list-view-record-search",
        value: "{{query}}",
      },
      { action: "press", selector: "#list-view-record-search", value: "Enter" },
      {
        action: "read_rows",
        selector: ".tabulator-row:not(.tabulator-headers)",
        key: "records",
        fields: {
          externalId: { selector: ".contact-name-link", attribute: "href" },
          name: { selector: ".contact-name-link" },
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

/** Bind the reviewed entry click to this connection's observed Contacts route. */
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
  return {
    steps: [
      { action: "goto", value: url.toString() },
      ...script.steps.slice(1),
    ],
  };
}
