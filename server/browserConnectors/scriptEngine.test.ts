import { describe, expect, it, vi } from "vitest";
import {
  executeSavedBrowserScript,
  renderBrowserTemplate,
  resolveBrowserNavigationTarget,
  validateSavedBrowserScript,
} from "./scriptEngine";

describe("saved browser connector scripts", () => {
  it("accepts deterministic form and row-extraction actions", () => {
    const script = validateSavedBrowserScript({
      steps: [
        { action: "goto", value: "https://crm.example.test/contacts" },
        {
          action: "fill",
          selector: "input[name='search']",
          value: "{{query}}",
        },
        { action: "press", selector: "input[name='search']", value: "Enter" },
        {
          action: "read_rows",
          selector: "table tbody tr",
          key: "records",
          fields: {
            externalId: { selector: "a", attribute: "data-id" },
            name: { selector: ".name" },
            email: { selector: ".email" },
          },
        },
      ],
    });
    expect(script.steps).toHaveLength(4);
    const rowScript = validateSavedBrowserScript({
      steps: [
        {
          action: "read_rows",
          selector: ".task-row",
          fields: {
            externalId: {
              selector: ".task-title",
              urlQueryParamAfterClick: "recordId",
              dismissSelectorBeforeClick: ".drawer-close",
            },
            status: {
              selector: ".completed-indicator",
              presentValue: "completed",
              absentValue: "pending",
            },
          },
        },
      ],
    });
    expect(
      rowScript.steps[0]?.fields?.externalId?.urlQueryParamAfterClick
    ).toBe("recordId");
    expect(
      rowScript.steps[0]?.fields?.externalId?.dismissSelectorBeforeClick
    ).toBe(".drawer-close");
    expect(rowScript.steps[0]?.fields?.status).toMatchObject({
      presentValue: "completed",
      absentValue: "pending",
    });
    expect(
      renderBrowserTemplate("/contact/{{ externalId }}", { externalId: 42 })
    ).toBe("/contact/42");
  });

  it("resolves relative record links against the current CRM page but rejects non-HTTP schemes", () => {
    expect(
      resolveBrowserNavigationTarget(
        "/v2/location/location-1/contacts/detail/contact-7",
        "https://crm.example.test/v2/location/location-1/contacts/"
      )
    ).toBe(
      "https://crm.example.test/v2/location/location-1/contacts/detail/contact-7"
    );
    expect(
      resolveBrowserNavigationTarget(
        "https://crm.example.test/v2/location/location-1/contacts/detail/contact-8",
        "https://crm.example.test/"
      )
    ).toBe(
      "https://crm.example.test/v2/location/location-1/contacts/detail/contact-8"
    );
    expect(() =>
      resolveBrowserNavigationTarget(
        "javascript:alert(1)",
        "https://crm.example.test/"
      )
    ).toThrow(/HTTP\(S\)/);
  });

  it("rejects executable selector or value content", () => {
    expect(() =>
      validateSavedBrowserScript({
        steps: [{ action: "click", selector: "javascript:alert(1)" }],
      })
    ).toThrow(/declarative/i);
    expect(() =>
      validateSavedBrowserScript({
        steps: [
          {
            action: "fill",
            selector: "input",
            value: "<script>alert(1)</script>",
          },
        ],
      })
    ).toThrow(/declarative/i);
    expect(() =>
      validateSavedBrowserScript({
        steps: [
          {
            action: "read_rows",
            selector: ".task-row",
            fields: {
              externalId: {
                selector: ".task-title",
                urlQueryParamAfterClick: "recordId&evil=1",
              },
            },
          },
        ],
      })
    ).toThrow(/query parameters/i);
  });

  it("allows only bounded declarative waits", () => {
    expect(
      validateSavedBrowserScript({
        steps: [{ action: "wait", value: "2000" }],
      }).steps[0]
    ).toMatchObject({ action: "wait", value: "2000" });
    expect(() =>
      validateSavedBrowserScript({
        steps: [{ action: "wait", value: "5001" }],
      })
    ).toThrow(/0-5000 milliseconds/i);
    expect(() =>
      validateSavedBrowserScript({
        steps: [{ action: "wait", value: "forever" }],
      })
    ).toThrow(/0-5000 milliseconds/i);
  });

  it("uses an authorised click fallback when a reviewed SPA control is present but inert", async () => {
    let current = "https://crm.example.test/v2/location/location-1/contacts/detail/contact-1";
    const fallback =
      "https://crm.example.test/v2/location/location-1/contacts/smart_list/All";
    const click = vi.fn(async () => undefined);
    const page = {
      url: () => current,
      waitForTimeout: vi.fn(async () => undefined),
      goto: vi.fn(async (url: string) => {
        current = url;
      }),
      locator: vi.fn(() => ({
        count: vi.fn(async () => 1),
        click,
      })),
    };
    const authorizeNavigation = vi.fn(async () => undefined);
    const result = await executeSavedBrowserScript({
      page: page as any,
      script: {
        steps: [
          {
            action: "click",
            selector: "#sb_contacts",
            fallbackUrl: fallback,
          },
        ],
      },
      inputs: {},
      artifactDirectory: "/tmp",
      artifactPrefix: "inert-navigation",
      authorizeNavigation,
    });
    expect(result.success, result.detail).toBe(true);
    expect(click).toHaveBeenCalledOnce();
    expect(page.goto).toHaveBeenCalledWith(
      fallback,
      expect.objectContaining({ waitUntil: "domcontentloaded" })
    );
    expect(authorizeNavigation).toHaveBeenCalledWith(fallback);
    expect(current).toBe(fallback);
  });

  it("rejects unbounded scripts", () => {
    expect(() =>
      validateSavedBrowserScript({
        steps: Array.from({ length: 81 }, () => ({
          action: "expect_visible" as const,
          selector: "body",
        })),
      })
    ).toThrow(/eighty/i);
  });
});

describe("literal CRM result filtering", () => {
  it("keeps quotes and CSS syntax in the search text out of selectors", async () => {
    const query = 'Sam \"Quoted\"], a';
    const row = {
      getAttribute: vi.fn(async () => "/contacts/detail/one"),
      innerText: vi.fn(async () => query),
    };
    const filtered = {
      count: vi.fn(async () => 1),
      nth: vi.fn(() => row),
      evaluateAll: vi.fn(async () => [
        { externalId: "/contacts/detail/one", name: query },
      ]),
    };
    const locator = { filter: vi.fn(() => filtered) };
    const page = { locator: vi.fn(() => locator) };
    const result = await executeSavedBrowserScript({
      page: page as any,
      script: {
        steps: [
          {
            action: "read_rows",
            selector: "a.contact",
            textFilter: "{{query}}",
            key: "records",
            fields: { externalId: { attribute: "href" }, name: {} },
          },
        ],
      },
      inputs: { query },
      artifactDirectory: "/tmp",
      artifactPrefix: "filter-test",
    });
    expect(result.success).toBe(true);
    expect(page.locator.mock.calls.every(call => call[0] === "a.contact")).toBe(
      true
    );
    expect(locator.filter).toHaveBeenCalledWith({ hasText: query });
    expect(JSON.parse(result.data.records)).toEqual([
      { externalId: "/contacts/detail/one", name: query },
    ]);
  });
  it("snapshots stable fields atomically without indexed reads on a virtualized grid", async () => {
    const nth = vi.fn(() => {
      throw new Error("stable extraction must not use nth()");
    });
    const rows = {
      count: vi.fn(async () => 20),
      nth,
      evaluateAll: vi.fn(async () => [
        {
          externalId: "owner-1",
          name: "Amelia De Beer",
        },
        {
          externalId: "owner-2",
          name: "Another Owner",
        },
      ]),
    };
    const page = { locator: vi.fn(() => rows) };
    const result = await executeSavedBrowserScript({
      page: page as any,
      script: {
        steps: [
          {
            action: "read_rows",
            selector: '[tabulator-field="owners"] [data-id]',
            key: "records",
            fields: {
              externalId: { attribute: "data-id" },
              name: { attribute: "tooltip" },
            },
          },
        ],
      },
      inputs: {},
      artifactDirectory: "/tmp",
      artifactPrefix: "virtual-grid",
    });
    expect(result.success, result.detail).toBe(true);
    expect(JSON.parse(result.data.records)).toEqual([
      { externalId: "owner-1", name: "Amelia De Beer" },
      { externalId: "owner-2", name: "Another Owner" },
    ]);
    expect(rows.evaluateAll).toHaveBeenCalledOnce();
    expect(nth).not.toHaveBeenCalled();
  });

  it("fails closed if a required search input is missing", async () => {
    const page = { locator: vi.fn(() => ({})) };
    const result = await executeSavedBrowserScript({
      page: page as any,
      script: {
        steps: [
          {
            action: "expect_visible",
            selector: "a.contact",
            textFilter: "{{query}}",
          },
        ],
      },
      inputs: {},
      artifactDirectory: "/tmp",
      artifactPrefix: "empty-test",
    });
    expect(result.success).toBe(false);
    expect(result.detail).toContain("BROWSER_TEXT_FILTER_EMPTY");
  });
});
