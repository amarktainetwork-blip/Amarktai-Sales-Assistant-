import { describe, expect, it } from "vitest";
import {
  GENIE_PROVIDER_PACK,
  GENIE_PROVIDER_PACK_VERSION,
  providerPackFingerprint,
  bindGenieContactNavigation,
} from "./providerPacks";

describe("canonical Genie provider pack", () => {
  it("contains reusable current contact selectors without tenant data", () => {
    const serialized = JSON.stringify(GENIE_PROVIDER_PACK);
    for (const selector of [
      "#sb_contacts",
      "/contacts/detail/",
      "Search Contacts",
      "contact.first_name",
      "contact.last_name",
      "contact.email",
      "contact.phone",
      "#owner-dropdown-trigger",
    ])
      expect(serialized).toContain(selector);
    expect(serialized).not.toContain(".tabulator-row");
    expect(serialized).not.toMatch(/Course2Career|locationId|customer@/i);
    expect(GENIE_PROVIDER_PACK_VERSION).toMatch(/^genie-/);
    expect(providerPackFingerprint()).toMatch(/^[a-f0-9]{64}$/);
  });

  it("reads contact-detail anchors as records without depending on a table framework", () => {
    const definition =
      GENIE_PROVIDER_PACK.operationDefinitions?.["contact.sync"];
    const executeScript = (definition?.definition as { executeScript?: string })
      ?.executeScript;
    const script = executeScript
      ? GENIE_PROVIDER_PACK.scripts[executeScript]
      : undefined;
    expect(script?.steps.map(step => step.action)).toEqual([
      "click",
      "expect_visible",
      "read_rows",
    ]);
    expect(script?.steps[1]).toMatchObject({
      action: "expect_visible",
      selector: expect.stringContaining("/contacts/detail/"),
    });
    expect(script?.steps[2]).toMatchObject({
      action: "read_rows",
      fields: {
        externalId: { attribute: "href" },
        name: {},
      },
    });
  });

  it("uses the visible current contact search control and the same durable record links", () => {
    const definition =
      GENIE_PROVIDER_PACK.operationDefinitions?.["contact.search"];
    const executeScript = (definition?.definition as { executeScript?: string })
      ?.executeScript;
    const script = executeScript
      ? GENIE_PROVIDER_PACK.scripts[executeScript]
      : undefined;
    expect(JSON.stringify(script)).toContain("Search Contacts");
    expect(JSON.stringify(script)).toContain("/contacts/detail/");
    expect(JSON.stringify(script)).not.toContain(".tabulator-row");
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

describe("Genie read safety", () => {
  it("filters contact-search results with literal input rather than injected CSS", () => {
    const steps = GENIE_PROVIDER_PACK.scripts.genie_contact_search.steps;
    expect(
      steps
        .filter(step => step.textFilter === "{{query}}")
        .map(step => step.action)
    ).toEqual(["expect_visible", "read_rows"]);
    expect(steps.some(step => step.selector?.includes("{{query}}"))).toBe(
      false
    );
  });
  it("does not misrepresent a displayed owner name as an immutable owner ID", () => {
    const fields =
      GENIE_PROVIDER_PACK.scripts.genie_contact_read.steps.at(-1)?.fields;
    expect(fields?.ownerName).toEqual({ selector: "#owner-dropdown-trigger" });
    expect(fields?.ownerExternalId).toBeUndefined();
  });
  it("preserves the authenticated Genie SPA click after validating the observed Contacts route", () => {
    const script = {
      steps: [
        { action: "click" as const, selector: "#sb_contacts" },
        {
          action: "expect_visible" as const,
          selector: "#list-view-record-search",
        },
      ],
    };
    const bound = bindGenieContactNavigation(script, {
      controls: [
        {
          selector: "#sb_contacts",
          href: "https://genie.example/v2/location/example/contacts/smart_list/All",
        },
      ],
    });
    expect(bound.steps[0]).toEqual({
      action: "click",
      selector: "#sb_contacts",
      fallbackUrl:
        "https://genie.example/v2/location/example/contacts/smart_list/All",
    });
    expect(bound.steps.slice(1)).toEqual(script.steps.slice(1));
  });
  it("rejects a contact detail page as the catalogue navigation target", () => {
    expect(() =>
      bindGenieContactNavigation(
        GENIE_PROVIDER_PACK.scripts.genie_contact_sync,
        {
          controls: [
            {
              selector: "#sb_contacts",
              href: "https://crm.example.test/contacts/detail/one",
            },
          ],
        }
      )
    ).toThrow("GENIE_CONTACT_NAVIGATION_INVALID");
  });
});
