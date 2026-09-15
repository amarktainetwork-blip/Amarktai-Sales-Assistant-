import { describe, expect, it } from "vitest";
import { assertPersonalBrowserOwnerScope } from "./personalOwnerScope";

describe("personal browser CRM owner scope", () => {
  it("accepts only records owned by the exact mapped CRM user", () => {
    expect(() =>
      assertPersonalBrowserOwnerScope({
        resourceType: "contacts",
        expectedOwnerExternalId: "owner-amelia",
        records: [{ ownerExternalId: "owner-amelia" }],
      })
    ).not.toThrow();
  });

  it("fails closed when a personal record has no immutable owner", () => {
    expect(() =>
      assertPersonalBrowserOwnerScope({
        resourceType: "contacts",
        expectedOwnerExternalId: "owner-amelia",
        records: [{ ownerExternalId: null }],
      })
    ).toThrow("CRM_OWNER_SCOPE_REQUIRED");
  });

  it("rejects another salesperson before persistence", () => {
    expect(() =>
      assertPersonalBrowserOwnerScope({
        resourceType: "tasks",
        expectedOwnerExternalId: "owner-amelia",
        records: [{ ownerExternalId: "owner-other" }],
      })
    ).toThrow("CRM_OWNER_SCOPE_VIOLATION");
  });

  it("does not owner-scope shared company records", () => {
    expect(() =>
      assertPersonalBrowserOwnerScope({
        resourceType: "companies",
        expectedOwnerExternalId: "owner-amelia",
        records: [{}],
      })
    ).not.toThrow();
  });
});
