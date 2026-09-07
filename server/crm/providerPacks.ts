import { createHash } from "node:crypto";
import type { BrowserProfile } from "../browserConnectors/browserCrmAdapter";

/** Reusable provider structure only: never tenant IDs, credentials or customer values. */
export const GENIE_PROVIDER_PACK_VERSION = "genie-2026.09.07.1";

const scripts: BrowserProfile["scripts"] = {
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
  resultKeys: { searchContacts: "records", getContact: "records" },
  operationDefinitions: {
    "contact.search": {
      definition: {
        mode: "read",
        executeScript: "genie_contact_search",
        resultKey: "records",
      },
      prerequisites: {
        providerPack: "genie",
        providerPackVersion: GENIE_PROVIDER_PACK_VERSION,
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
      },
    },
  },
};

export function providerPackFingerprint() {
  return createHash("sha256")
    .update(JSON.stringify(GENIE_PROVIDER_PACK))
    .digest("hex");
}
