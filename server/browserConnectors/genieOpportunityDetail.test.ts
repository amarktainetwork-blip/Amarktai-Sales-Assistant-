import { describe, expect, it, vi } from "vitest";
import {
  exactGenieOpportunityRecord,
  exactGenieOpportunityScope,
  readOwnerScopedGenieOpportunityDetail,
} from "./genieOpportunityDetail";

const root = "https://genie.entrepreneurscircle.org/v2/location/loc/tasks";
const opportunity = {
  id: "op-1",
  locationId: "loc",
  assignedTo: "amelia",
  contactId: "c-1",
  pipelineId: "p",
  pipelineStageId: "s",
  name: "Enquiry",
  status: "won",
  monetaryValue: 100,
  lastStatusChangeAt: "2026-09-24T12:00:00.000Z",
  updatedAt: "2026-09-24T12:00:00.000Z",
};
const pipelines = [
  {
    id: "p",
    locationId: "loc",
    name: "Sales",
    stages: [{ id: "s", name: "Closed Won" }],
  },
];
const response = (status: number, data?: unknown) => ({
  status: () => status,
  ok: () => status >= 200 && status < 300,
  json: async () => data,
});
const fakePage = (...responses: ReturnType<typeof response>[]) => {
  const get = vi.fn();
  for (const item of responses) get.mockResolvedValueOnce(item);
  const page = {
    url: () => root,
    evaluate: async () => "live-token",
    context: () => ({ request: { get } }),
  } as any;
  return { page, get };
};
const scope = {
  locationId: "loc",
  externalId: "op-1",
  ownerExternalId: "amelia",
};

describe("exact owner-scoped Genie opportunity read", () => {
  it("validates the requested immutable ID and authenticated Genie location", () => {
    expect(exactGenieOpportunityScope(root, "op-1", "amelia")).toEqual(scope);
    expect(() =>
      exactGenieOpportunityScope(root, "../other", "amelia")
    ).toThrow("SCOPE");
    expect(() =>
      exactGenieOpportunityScope(
        "https://evil.invalid/v2/location/loc/tasks",
        "op-1",
        "amelia"
      )
    ).toThrow("SCOPE");
    expect(() => exactGenieOpportunityScope(root, "op-1", "")).toThrow("SCOPE");
  });
  it("rejects foreign owners, locations and a different actual record", () => {
    for (const field of ["id", "assignedTo", "locationId"] as const) {
      expect(() =>
        exactGenieOpportunityRecord(
          { ...opportunity, [field]: "other" },
          scope,
          pipelines
        )
      ).toThrow("SCOPE_VIOLATION");
    }
    expect(() =>
      exactGenieOpportunityRecord(opportunity, scope, [
        { ...pipelines[0], locationId: "other" },
      ])
    ).toThrow("PIPELINE_LOCATION_INVALID");
  });
  it("reads only two fixed GET endpoints and preserves source sale evidence", async () => {
    const { page, get } = fakePage(
      response(200, { opportunity }),
      response(200, { pipelines })
    );
    const assertControl = vi.fn();
    const row = await readOwnerScopedGenieOpportunityDetail({
      page,
      externalId: "op-1",
      ownerExternalId: "amelia",
      assertControl,
    });
    expect(row).toMatchObject({
      externalId: "op-1",
      ownerExternalId: "amelia",
      contactExternalId: "c-1",
      pipeline: "Sales",
      stage: "Closed Won",
      valueMinor: 10000,
      raw: { status: "won", sourceKind: "genie_exact_owner_scoped_get" },
    });
    expect(row?.closeAt?.toISOString()).toBe("2026-09-24T12:00:00.000Z");
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[0][0]).toBe(
      "https://services.leadconnectorhq.com/opportunities/op-1"
    );
    expect(get.mock.calls[1][0]).toBe(
      "https://services.leadconnectorhq.com/opportunities/pipelines?locationId=loc"
    );
    expect(assertControl).toHaveBeenCalled();
  });
  it("rejects an incorrect first source response before reading pipeline metadata", async () => {
    const { page, get } = fakePage(
      response(200, { opportunity: { ...opportunity, assignedTo: "other" } })
    );
    await expect(
      readOwnerScopedGenieOpportunityDetail({
        page,
        externalId: "op-1",
        ownerExternalId: "amelia",
        assertControl: () => {},
      })
    ).rejects.toThrow("OWNER_SCOPE_VIOLATION");
    expect(get).toHaveBeenCalledOnce();
  });
  it("returns null on verified source 404, without fabricating a record", async () => {
    const { page, get } = fakePage(response(404));
    expect(
      await readOwnerScopedGenieOpportunityDetail({
        page,
        externalId: "op-1",
        ownerExternalId: "amelia",
        assertControl: () => {},
      })
    ).toBeNull();
    expect(get).toHaveBeenCalledOnce();
  });
  it.each([401, 403])(
    "bounded retry on transient %s stays GET-only",
    async status => {
      const { page, get } = fakePage(
        response(status),
        response(200, { opportunity }),
        response(200, { pipelines })
      );
      const row = await readOwnerScopedGenieOpportunityDetail({
        page,
        externalId: "op-1",
        ownerExternalId: "amelia",
        assertControl: () => {},
      });
      expect(row?.externalId).toBe("op-1");
      expect(get).toHaveBeenCalledTimes(3);
    }
  );
  it("stops when the browser lease is revoked during an authentication retry", async () => {
    let leaseOwned = true;
    const get = vi.fn(async () => {
      leaseOwned = false;
      return response(403);
    });
    const evaluate = vi.fn(async () => "live-token");
    const page = {
      url: () => root,
      evaluate,
      context: () => ({ request: { get } }),
    } as any;
    await expect(readOwnerScopedGenieOpportunityDetail({
      page,
      externalId: "op-1",
      ownerExternalId: "amelia",
      assertControl: () => {
        if (!leaseOwned) throw Error("CRM_VIEWER_AGENT_CONTROL_ACTIVE");
      },
    })).rejects.toThrow("CRM_VIEWER_AGENT_CONTROL_ACTIVE");
    expect(get).toHaveBeenCalledOnce();
    // A revoked lease also blocks reading the human's refreshed credential.
    expect(evaluate).toHaveBeenCalledOnce();
  });
  it("checks browser ownership before the first token lookup", async () => {
    const { page, get } = fakePage();
    const evaluate = vi.fn(async () => "live-token");
    page.evaluate = evaluate;
    await expect(readOwnerScopedGenieOpportunityDetail({
      page,
      externalId: "op-1",
      ownerExternalId: "amelia",
      assertControl: () => { throw Error("CRM_VIEWER_AGENT_CONTROL_ACTIVE"); },
    })).rejects.toThrow("CRM_VIEWER_AGENT_CONTROL_ACTIVE");
    expect(evaluate).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it("fails closed after bounded repeated rejected source credentials", async () => {
    const { page, get } = fakePage(response(403), response(403), response(403));
    await expect(
      readOwnerScopedGenieOpportunityDetail({
        page,
        externalId: "op-1",
        ownerExternalId: "amelia",
        assertControl: () => {},
      })
    ).rejects.toThrow("REAUTHENTICATION_REQUIRED");
    expect(get).toHaveBeenCalledTimes(3);
  });
  it("rejects missing token without making any Genie request", async () => {
    const { page, get } = fakePage();
    page.evaluate = async () => "";
    await expect(
      readOwnerScopedGenieOpportunityDetail({
        page,
        externalId: "op-1",
        ownerExternalId: "amelia",
        assertControl: () => {},
      })
    ).rejects.toThrow("REAUTHENTICATION_REQUIRED");
    expect(get).not.toHaveBeenCalled();
  });
});
