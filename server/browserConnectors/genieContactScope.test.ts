import { describe, expect, it, vi } from "vitest";
import {
  executeOwnerScopedGenieContactRead,
  fetchOwnerScopedContactPage,
  genieContactDrainIncomplete,
  genieContactSearchAfter,
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

  it("reads only the newest owner-scoped page for the lead fast path", async () => {
    const post = vi.fn().mockResolvedValue({
      status: () => 200,
      ok: () => true,
      json: async () => ({
        contacts: Array.from({ length: 100 }, (_, index) => ({
          id: `contact-${index + 1}`,
          assignedTo: "owner-amelia",
          sort: [
            `2026-09-17T09:${String(index % 60).padStart(2, "0")}:00Z`,
            `contact-${index + 1}`,
          ],
        })),
        total: 23_961,
      }),
    });
    const page = {
      url: () =>
        "https://app.example/v2/location/location-1/contacts/smart_list/All",
      evaluate: vi.fn(async () => "token"),
      context: () => ({ request: { post } }),
    } as any;
    const execution = {
      success: true,
      completedAt: new Date().toISOString(),
      detail: "ok",
      data: {} as Record<string, string>,
    };
    const result = await executeOwnerScopedGenieContactRead({
      page,
      script: {
        steps: [
          {
            action: "goto",
            value:
              "https://app.example/v2/location/location-1/contacts/smart_list/All",
          },
        ],
      },
      ownerExternalId: "owner-amelia",
      runScript: vi.fn(async () => execution),
      assertControl: vi.fn(),
      latestPageOnly: true,
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.data.records)).toHaveLength(100);
    expect(result.data.pagesRead).toBe("1");
    expect(result.data.sourceTotal).toBe("23961");
    expect(result.data.latestPageOnly).toBe("true");
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
          filters: [{ field: "assigned_to", operator: "eq", value: "other" }],
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

  it("uses the last contact sort value as the next searchAfter cursor", () => {
    expect(
      genieContactSearchAfter({
        contacts: [
          { id: "contact-1", sort: ["2026-09-16T08:00:00Z", "contact-1"] },
          { id: "contact-2", sort: ["2026-09-16T09:00:00Z", "contact-2"] },
        ],
      })
    ).toEqual(["2026-09-16T09:00:00Z", "contact-2"]);
    expect(genieContactSearchAfter({ contacts: [] })).toBeUndefined();
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

  it("refreshes the Genie token once when an owner-scoped contact page returns 401", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({
        status: () => 401,
        ok: () => false,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        status: () => 200,
        ok: () => true,
        json: async () => ({
          contacts: [
            {
              id: "contact-1",
              assignedTo: "owner-amelia",
              sort: ["2026-09-16T09:00:00Z", "contact-1"],
            },
          ],
          total: 1,
        }),
      });
    const page = {
      evaluate: vi.fn(async () => "token-new"),
      context: () => ({ request: { post } }),
    } as any;

    const result = await fetchOwnerScopedContactPage({
      page,
      token: "token-old",
      locationId: "location-1",
      ownerExternalId: "owner-amelia",
      pageNumber: 1,
    });

    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0][1].headers["token-id"]).toBe("token-old");
    expect(post.mock.calls[1][1].headers["token-id"]).toBe("token-new");
    expect(result.token).toBe("token-new");
    expect(result.records).toHaveLength(1);
  });

  it("falls back to Bearer auth after refreshed token-id auth is rejected", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({
        status: () => 401,
        ok: () => false,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        status: () => 401,
        ok: () => false,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        status: () => 200,
        ok: () => true,
        json: async () => ({
          contacts: [
            {
              id: "contact-1",
              assignedTo: "owner-amelia",
              sort: ["2026-09-16T09:00:00Z", "contact-1"],
            },
          ],
          total: 1,
        }),
      });
    const page = {
      evaluate: vi.fn(async () => "token-new"),
      context: () => ({ request: { post } }),
    } as any;

    const result = await fetchOwnerScopedContactPage({
      page,
      token: "token-old",
      locationId: "location-1",
      ownerExternalId: "owner-amelia",
      pageNumber: 1,
    });
    expect(post).toHaveBeenCalledTimes(3);
    expect(post.mock.calls[2][1].headers.Authorization).toBe(
      "Bearer token-new"
    );
    expect(post.mock.calls[2][1].headers["token-id"]).toBeUndefined();
    expect(result.records).toHaveLength(1);
  });

  it("refreshes a rejected contact read from window.getToken before retrying authentication", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({ status: () => 401, ok: () => false, json: async () => ({}) })
      .mockResolvedValueOnce({
        status: () => 200,
        ok: () => true,
        json: async () => ({ contacts: [{ id: "contact-1", assignedTo: "owner-amelia" }], total: 1 }),
      });
    const page = {
      evaluate: vi.fn(async () => "fresh-window-token"),
      context: () => ({ request: { post } }),
    } as any;

    const result = await fetchOwnerScopedContactPage({
      page,
      token: "stale-stored-token",
      locationId: "location-1",
      ownerExternalId: "owner-amelia",
      pageNumber: 1,
    });
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1][1].headers["token-id"]).toBe("fresh-window-token");
    expect(result.records).toHaveLength(1);
  });

  it("fails closed after refreshed token-id and Bearer authentication are both rejected", async () => {
    const post = vi.fn().mockResolvedValue({
      status: () => 401,
      ok: () => false,
      json: async () => ({}),
    });
    const page = {
      evaluate: vi.fn(async () => "token-new"),
      context: () => ({ request: { post } }),
    } as any;

    await expect(
      fetchOwnerScopedContactPage({
        page,
        token: "token-old",
        locationId: "location-1",
        ownerExternalId: "owner-amelia",
        pageNumber: 1,
      })
    ).rejects.toThrow(
      "GENIE_CONTACT_SEARCH_HTTP_ERROR: Contacts search page 1 returned HTTP 401."
    );
    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(3);
    expect(post.mock.calls[2][1].headers.Authorization).toBe(
      "Bearer token-new"
    );
  });

  it("treats Genie total as advisory when the owner-scoped stream ends", () => {
    expect(
      genieContactDrainIncomplete({
        total: 23_955,
        uniqueRecords: 10_000,
        lastPageRecords: 0,
        pagesRead: 101,
      })
    ).toBe(false);
  });

  it("fails closed when the owner-scoped hard cap ends on a full page", () => {
    expect(
      genieContactDrainIncomplete({
        total: undefined,
        uniqueRecords: 50_000,
        lastPageRecords: 100,
        pagesRead: 500,
      })
    ).toBe(true);
  });

  it("allows a bounded drain when the final page is short", () => {
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

it("retains source, tags and field values without making provider fields generic requirements", () => {
  const row = normalizeGenieContactSearchPage(
    {
      contacts: [
        {
          id: "c",
          assignedTo: "owner",
          source: "enquiry",
          tags: ["interested"],
          customFields: [
            {
              id: "field1",
              name: "ELCAS form",
              fieldValueString: "career change",
            },
            { id: "field2", fieldValueArray: ["a", "b"] },
          ],
        },
      ],
      total: 1,
    },
    "owner"
  ).records[0];
  expect(JSON.parse(row.normalizedCustomerContext)).toEqual({
    source: "enquiry",
    tags: ["interested"],
    customFields: { field1: "career change", field2: ["a", "b"] },
    customFieldLabels: { field1: "ELCAS form" },
  });
});

it.each([503, 520])(
  "retries transient HTTP %s without changing its exact owner filter",
  async status => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({ status: () => status, ok: () => false })
      .mockResolvedValue({
        status: () => 200,
        ok: () => true,
        json: async () => ({
          contacts: [{ id: "c", assignedTo: "owner" }],
          total: 1,
        }),
      });
    const result = await fetchOwnerScopedContactPage({
      page: { context: () => ({ request: { post } }) } as any,
      token: "token",
      locationId: "loc",
      ownerExternalId: "owner",
      pageNumber: 1,
    });
    expect(result.total).toBe(1);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0][1].data).toEqual(post.mock.calls[1][1].data);
    expect(post.mock.calls[1][1].data.filters).toEqual([
      { field: "assigned_to", operator: "eq", value: "owner" },
    ]);
  }
);
