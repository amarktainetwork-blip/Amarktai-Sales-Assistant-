import { describe, expect, it } from "vitest";
import {
  normalizeGenieContactSearchPage,
  scopeGenieContactSearchBody,
} from "./genieContactScope";

describe("Genie owner-scoped contact search", () => {
  it("forces the immutable mapped owner into the outgoing search", () => {
    expect(
      scopeGenieContactSearchBody(
        {
          page: 1,
          filters: [
            { field: "status", operator: "eq", value: "open" },
            { field: "assignedTo", operator: "eq", value: "other" },
          ],
        },
        "owner-amelia"
      )
    ).toEqual({
      page: 1,
      filters: [
        { field: "status", operator: "eq", value: "open" },
        {
          field: "assignedTo",
          operator: "eq",
          value: "owner-amelia",
        },
      ],
    });
  });
  it("keeps only exact-owner structured contacts", () => {
    expect(
      normalizeGenieContactSearchPage(
        {
          contacts: [
            {
              id: "contact-1",
              assignedTo: "owner-amelia",
              firstName: "Test",
            },
          ],
          total: 1,
        },
        "owner-amelia"
      )
    ).toMatchObject({
      total: 1,
      records: [
        {
          externalId: "contact-1",
          ownerExternalId: "owner-amelia",
        },
      ],
    });
  });

  it("rejects another salesperson or a missing owner", () => {
    expect(() =>
      normalizeGenieContactSearchPage(
        { contacts: [{ id: "contact-1", assignedTo: "owner-other" }] },
        "owner-amelia"
      )
    ).toThrow("CRM_OWNER_SCOPE_VIOLATION");
    expect(() =>
      normalizeGenieContactSearchPage(
        { contacts: [{ id: "contact-2" }] },
        "owner-amelia"
      )
    ).toThrow("CRM_OWNER_SCOPE_REQUIRED");
  });
});
