import { describe, expect, it } from "vitest";
import {
  genieContactDrainIncomplete,
  normalizeGenieContactSearchPage,
  ownerScopedGenieContactNavigation,
  scopeGenieContactSearchBody,
} from "./genieContactScope";

describe("Genie owner-scoped contact search", () => {
  it("uses the reviewed fallback URL instead of an obstructable Contacts menu click", () => {
    expect(
      ownerScopedGenieContactNavigation({
        steps: [
          {
            action: "click",
            selector: "#sb_contacts",
            fallbackUrl:
              "https://genie.example/v2/location/location-1/contacts/smart_list/All",
          },
          { action: "wait_for_url", value: "**/contacts/smart_list/**" },
          { action: "wait", value: "2000" },
          { action: "expect_visible", selector: "a.contact-name-link" },
          {
            action: "read_rows",
            selector: "a.contact-name-link",
            key: "records",
          },
        ],
      })
    ).toEqual({
      steps: [
        {
          action: "goto",
          value:
            "https://genie.example/v2/location/location-1/contacts/smart_list/All",
        },
        { action: "wait_for_url", value: "**/contacts/smart_list/**" },
        { action: "wait", value: "2000" },
      ],
    });
  });

  it("forces the immutable mapped owner into the outgoing search", () => {
    expect(
      scopeGenieContactSearchBody(
        {
          locationId: "loc-1",
          page: 1,
          pageLimit: 100,
          sort: [],
          query: "",
          filters: [
            { field: "assigned_to", operator: "eq", value: "other" },
          ],
        },
        "owner-amelia"
      )
    ).toEqual({
      locationId: "loc-1",
      page: 1,
      pageLimit: 100,
      sort: [],
      query: "",
      filters: [
        {
          field: "assigned_to",
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

  it("fails closed when an unknown-total final allowed page is still full", () => {
    expect(
      genieContactDrainIncomplete({
        total: undefined,
        uniqueRecords: 10_000,
        lastPageRecords: 100,
        pagesRead: 100,
      })
    ).toBe(true);
  });

  it("allows an unknown-total bounded drain when the final page is short", () => {
    expect(
      genieContactDrainIncomplete({
        total: undefined,
        uniqueRecords: 9_950,
        lastPageRecords: 50,
        pagesRead: 100,
      })
    ).toBe(false);
  });
});
