import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readiness: vi.fn() }));
vi.mock("../browserConnectors/learnedOperations", () => ({
  browserOperationReadinessForSystem: mocks.readiness,
}));

import { getOrganisationGenieReadiness } from "./organisationReadiness";

describe("organisation Genie readiness", () => {
  beforeEach(() => mocks.readiness.mockReset());

  it("uses connected-system verification and learned operations instead of GENIE_* environment state", async () => {
    delete process.env.GENIE_LOGIN_URL;
    delete process.env.GENIE_USERNAME;
    delete process.env.GENIE_PASSWORD;
    mocks.readiness.mockResolvedValue({
      operations: [
        { key: "contact.read", status: "LIVE_PROVEN" },
        { key: "dialler.launch", status: "TEST_READY" },
      ],
    });
    const result = await getOrganisationGenieReadiness(7, [
      {
        id: 8,
        provider: "genie",
        connectionMethod: "browser",
        status: "limited_permissions",
        verifiedCapabilities: ["contacts.read"],
      },
    ]);
    expect(result).toMatchObject({
      configured: true,
      ready: true,
      status: "commissioned",
      connectedSystemIds: [8],
      verifiedCapabilities: ["contacts.read"],
      liveOperations: ["contact.read"],
    });
    expect(mocks.readiness).toHaveBeenCalledWith({
      organisationId: 7,
      connectedSystemId: 8,
    });
  });
});
