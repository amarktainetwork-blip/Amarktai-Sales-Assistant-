import { describe, expect, it } from "vitest";
import {
  GENIE_PROVIDER_PACK,
  GENIE_PROVIDER_PACK_VERSION,
  providerPackFingerprint,
} from "./providerPacks";

describe("canonical Genie provider pack", () => {
  it("contains the reviewed reusable contact selectors without tenant data", () => {
    const serialized = JSON.stringify(GENIE_PROVIDER_PACK);
    for (const selector of [
      "#sb_contacts",
      "#list-view-record-search",
      ".tabulator-row:not(.tabulator-headers)",
      ".contact-name-link",
      "contact.first_name",
      "contact.last_name",
      "contact.email",
      "contact.phone",
      "#owner-dropdown-trigger",
    ])
      expect(serialized).toContain(selector);
    expect(serialized).not.toMatch(/Course2Career|locationId|customer@/i);
    expect(GENIE_PROVIDER_PACK_VERSION).toMatch(/^genie-/);
    expect(providerPackFingerprint()).toMatch(/^[a-f0-9]{64}$/);
  });

  it("ships only TEST_READY inputs for later deterministic certification", () => {
    expect(Object.keys(GENIE_PROVIDER_PACK.operationDefinitions || {})).toEqual(
      ["contact.sync", "contact.search", "contact.read"]
    );
    expect(JSON.stringify(GENIE_PROVIDER_PACK)).not.toContain("LIVE_PROVEN");
  });

  it("derives tenant verification targets rather than embedding customer data", () => {
    const definitions = GENIE_PROVIDER_PACK.operationDefinitions || {};
    expect(definitions["contact.sync"]?.prerequisites).toMatchObject({
      verificationInputRole: "contact_catalogue_seed",
    });
    expect(definitions["contact.search"]?.prerequisites).toMatchObject({
      verificationInputRole: "derived_contact_query",
    });
    expect(definitions["contact.read"]?.prerequisites).toMatchObject({
      verificationInputRole: "derived_contact_external_id",
    });
  });
});
