import { describe, expect, it } from "vitest";
import { renderBrowserTemplate, validateSavedBrowserScript } from "./scriptEngine";

describe("saved browser connector scripts", () => {
  it("accepts deterministic form and row-extraction actions", () => {
    const script = validateSavedBrowserScript({ steps: [
      { action: "goto", value: "https://crm.example.test/contacts" },
      { action: "fill", selector: "input[name='search']", value: "{{query}}" },
      { action: "press", selector: "input[name='search']", value: "Enter" },
      { action: "read_rows", selector: "table tbody tr", key: "records", fields: { externalId: { selector: "a", attribute: "data-id" }, name: { selector: ".name" }, email: { selector: ".email" } } },
    ] });
    expect(script.steps).toHaveLength(4);
    expect(renderBrowserTemplate("/contact/{{ externalId }}", { externalId: 42 })).toBe("/contact/42");
  });

  it("rejects executable selector or value content", () => {
    expect(() => validateSavedBrowserScript({ steps: [{ action: "click", selector: "javascript:alert(1)" }] })).toThrow(/declarative/i);
    expect(() => validateSavedBrowserScript({ steps: [{ action: "fill", selector: "input", value: "<script>alert(1)</script>" }] })).toThrow(/declarative/i);
  });

  it("rejects unbounded scripts", () => {
    expect(() => validateSavedBrowserScript({ steps: Array.from({ length: 81 }, () => ({ action: "expect_visible" as const, selector: "body" })) })).toThrow(/eighty/i);
  });
});
