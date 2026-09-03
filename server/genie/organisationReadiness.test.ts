import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readiness: vi.fn() }));
vi.mock("../browserConnectors/learnedOperations", () => ({
  browserOperationReadinessForSystem: mocks.readiness,
}));

import { getOrganisationGenieReadiness } from "./organisationReadiness";

const coreOperations = [
  "contact.search",
  "contact.read",
  "task.list",
  "note.create",
  "task.create_callback",
  "opportunity.read",
  "opportunity.update",
] as const;

function operation(key: string, status: string) {
  return {
    key,
    label: key,
    area: "test",
    mode:
      key.includes("create") || key.includes("update")
        ? ("write" as const)
        : ("read" as const),
    safeWatchdog: true,
    status,
    version: status === "NOT_LEARNED" ? 0 : 1,
    lastTestAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
    evidence: {},
  };
}

function matrix(live: string[], optionalStatus = "NOT_LEARNED") {
  return {
    operations: [
      ...coreOperations.map(key =>
        operation(key, live.includes(key) ? "LIVE_PROVEN" : "NOT_LEARNED")
      ),
      operation("email.send", optionalStatus),
    ],
    capabilities: [],
  };
}

function genieSystem(status = "limited_permissions") {
  return {
    id: 8,
    provider: "genie",
    connectionMethod: "browser",
    status,
    verifiedCapabilities: ["contacts.read"],
  };
}

describe("organisation Genie readiness", () => {
  beforeEach(() => mocks.readiness.mockReset());

  it("does not call an authenticated connection ready after only one proven read", async () => {
    mocks.readiness.mockResolvedValue(matrix(["contact.read"]));
    const system = genieSystem();
    const result = await getOrganisationGenieReadiness(7, [system]);

    expect(result).toMatchObject({
      configured: true,
      ready: false,
      coreOperational: false,
      status: "authenticated_training_required",
      operationalStatus: "commissioning",
      connectedSystemIds: [8],
      verifiedCapabilities: ["contacts.read"],
      liveOperations: ["contact.read"],
    });
    expect(result.summary).toContain("not yet LIVE_PROVEN");
    expect(mocks.readiness).toHaveBeenCalledWith({
      organisationId: 7,
      connectedSystemId: 8,
    });
  });

  it("becomes operational only after the existing core commissioning gate is proven", async () => {
    mocks.readiness.mockResolvedValue(matrix([...coreOperations]));
    const result = await getOrganisationGenieReadiness(7, [genieSystem()]);

    expect(result).toMatchObject({
      ready: true,
      coreOperational: true,
      allCatalogueOperationsProven: false,
      status: "commissioned",
      operationalStatus: "operational_with_limits",
    });
    expect(result.liveOperations).toEqual(
      expect.arrayContaining([...coreOperations])
    );
  });

  it("keeps a configured connection that has not passed verification in needs-attention state", async () => {
    const result = await getOrganisationGenieReadiness(7, [
      genieSystem("needs_attention"),
    ]);

    expect(result).toMatchObject({
      configured: true,
      ready: false,
      coreOperational: false,
      status: "needs_attention",
      operationalStatus: "needs_attention",
    });
    expect(mocks.readiness).not.toHaveBeenCalled();
  });
});
