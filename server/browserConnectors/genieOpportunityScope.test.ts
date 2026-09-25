import { describe, expect, it, vi } from "vitest";
import {
  normalizeGenieOpportunities,
  readOwnerScopedGenieOpportunities,
} from "./genieOpportunityScope";
const row = (id: string) => ({
  id,
  assignedTo: "owner",
  locationId: "loc",
  contactId: "contact",
  name: "Enquiry",
  pipelineId: "p",
  pipelineStageId: "s",
  monetaryValue: 25,
  status: "lost",
});
const pipelines = [
  {
    id: "p",
    locationId: "loc",
    name: "Pipeline",
    stages: [{ id: "s", name: "Closed" }],
  },
];
describe("Genie opportunity read", () => {
  it("normalizes only proven identifiers, relations and lifecycle", () => {
    expect(
      normalizeGenieOpportunities(
        { opportunities: [row("1")] },
        "owner",
        "loc",
        pipelines
      )[0]
    ).toMatchObject({
      externalId: "1",
      contactExternalId: "contact",
      ownerExternalId: "owner",
      stage: "Closed",
      status: "lost",
      value: "25",
    });
  });
  it("uses the authoritative Won status-change time as the sale time", () => {
    const normalized = normalizeGenieOpportunities(
      {
        opportunities: [
          {
            ...row("won-1"),
            status: "won",
            lastStatusChangeAt: "2026-09-24T10:15:00.000Z",
            updatedAt: "2026-09-25T11:30:00.000Z",
          },
        ],
      },
      "owner",
      "loc",
      pipelines
    )[0];
    expect(normalized.closeAt).toBe("2026-09-24T10:15:00.000Z");
    expect(normalized.lastStatusChangeAt).toBe(
      "2026-09-24T10:15:00.000Z"
    );
  });

  it.each([
    { assignedTo: "foreign" },
    { assignedTo: null },
    { locationId: "foreign" },
  ])("rejects ambiguous or foreign scope %s", change => {
    expect(() =>
      normalizeGenieOpportunities(
        { opportunities: [{ ...row("1"), ...change }] },
        "owner",
        "loc",
        pipelines
      )
    ).toThrow("CRM_OWNER_SCOPE_VIOLATION");
  });
  it("fully drains with exclusive cursor pagination and GET only", async () => {
    const get = vi.fn(async (url: string) => ({
      ok: () => true,
      status: () => 200,
      json: async () =>
        url.includes("pipelines")
          ? { pipelines }
          : url.includes("startAfter=")
            ? { opportunities: [row("101")], meta: { total: 101 } }
            : {
                opportunities: Array.from({ length: 100 }, (_, i) =>
                  row(String(i))
                ),
                meta: { total: 101, startAfter: 123, startAfterId: "99" },
              },
    }));
    const control = vi.fn();
    const r = await readOwnerScopedGenieOpportunities({
      page: {
        url: () => "https://example.test/v2/location/loc/contacts",
        evaluate: async () => "token",
        context: () => ({ request: { get } }),
      } as any,
      ownerExternalId: "owner",
      assertControl: control,
    });
    expect(r.data.sourceTotal).toBe("101");
    expect(r.data.pagesRead).toBe("2");
    const url = new URL(get.mock.calls[2][0]);
    expect(url.searchParams.has("page")).toBe(false);
    expect(url.searchParams.get("assigned_to")).toBe("owner");
    expect(control).toHaveBeenCalledTimes(3);
  });
  it("fails an incomplete source count instead of publishing a partial set", async () => {
    const get = vi.fn(async (url: string) => ({
      ok: () => true,
      status: () => 200,
      json: async () =>
        url.includes("pipelines")
          ? { pipelines }
          : { opportunities: [row("1")], meta: { total: 500 } },
    }));
    await expect(
      readOwnerScopedGenieOpportunities({
        page: {
          url: () => "https://example.test/v2/location/loc/contacts",
          evaluate: async () => "token",
          context: () => ({ request: { get } }),
        } as any,
        ownerExternalId: "owner",
        assertControl: () => {},
      })
    ).rejects.toThrow("DRAIN_INCOMPLETE");
  });
});
