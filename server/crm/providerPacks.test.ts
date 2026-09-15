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
    const contactScripts = JSON.stringify({
      sync: GENIE_PROVIDER_PACK.scripts.genie_contact_sync,
      search: GENIE_PROVIDER_PACK.scripts.genie_contact_search,
      read: GENIE_PROVIDER_PACK.scripts.genie_contact_read,
    });
    expect(contactScripts).not.toContain(".tabulator-row");
    expect(serialized).not.toMatch(/Course2Career|X46Nx9|customer@/i);
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
      "wait_for_url",
      "wait",
      "expect_visible",
      "read_rows",
    ]);
    expect(script?.steps[3]).toMatchObject({
      action: "expect_visible",
      selector: expect.stringContaining("/contacts/detail/"),
    });
    expect(script?.steps[4]).toMatchObject({
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
      expect.arrayContaining([
        "contact.sync",
        "contact.search",
        "contact.read",
        "company.sync",
        "task.sync",
        "owner.sync",
        "opportunity.sync",
        "pipeline.list",
        "activity.sync",
      ])
    );
    expect(JSON.stringify(GENIE_PROVIDER_PACK)).not.toContain("LIVE_PROVEN");
  });

  it("ships deterministic read scripts for the live Genie workspace surfaces", () => {
    expect(
      JSON.stringify(GENIE_PROVIDER_PACK.scripts.genie_company_sync)
    ).toContain("properties.name");
    expect(
      GENIE_PROVIDER_PACK.scripts.genie_company_sync.steps
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "read_text",
        selector: '#tb_business, h1, h2, [role="heading"]',
        key: "collectionEvidence",
      }),
    ]));
    const taskScript = GENIE_PROVIDER_PACK.scripts.genie_task_sync;
    expect(JSON.stringify(taskScript)).toContain("recordId");
    expect(taskScript.steps.at(-1)).toMatchObject({
      action: "paginate_rows",
      nextSelector: 'button.tabulator-page[aria-label="Next Page"]',
      maxPages: 100,
      fields: {
        externalId: {
          urlQueryParamAfterClick: "recordId",
          dismissSelectorBeforeClick:
            '.hr-drawer-container button[aria-label="close"]',
        },
        description: {},
        contactExternalId: { attribute: "href" },
        ownerExternalId: { attribute: "data-id" },
        dueAt: {},
      },
    });
    expect(
      GENIE_PROVIDER_PACK.scripts.genie_company_sync.steps.some(
        step => step.action === "expect_visible" &&
          step.selector?.includes("properties.name")
      )
    ).toBe(false);
    expect(
      GENIE_PROVIDER_PACK.scripts.genie_owner_sync.steps.at(-1)
    ).toMatchObject({
      action: "paginate_rows",
      nextSelector: 'button.tabulator-page[aria-label="Next Page"]',
      maxPages: 100,
      fields: {
        externalId: { attribute: "data-id" },
        name: { attribute: "tooltip" },
      },
    });
    expect(
      JSON.stringify(GENIE_PROVIDER_PACK.scripts.genie_opportunity_sync)
    ).toContain("crm-opportunities-stage-count");
    expect(
      JSON.stringify(GENIE_PROVIDER_PACK.scripts.genie_pipeline_list)
    ).toContain("pipelineDropdDown-listview");
    const activityScript = JSON.stringify(
      GENIE_PROVIDER_PACK.scripts.genie_activity_sync
    );
    expect(activityScript).toContain("#conversations-list");
    expect(activityScript).toContain("conversation-card-checkbox-");
    expect(activityScript).not.toContain("ASSERT_LC_LEFTPANEL");
    expect(activityScript).not.toContain("MESSAGE_DETAILS");
    expect(
      GENIE_PROVIDER_PACK.operationDefinitions?.["activity.sync"]?.prerequisites
    ).toMatchObject({ activitySyncVersion: 2 });
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
