import { describe, expect, it } from "vitest";
import { callCrmReadbackAcceptance } from "./featureAcceptance";

describe("call CRM readback acceptance", () => {
  it("is not applicable while CRM writes are deliberately disabled", () => {
    expect(
      callCrmReadbackAcceptance({
        writesEnabled: false,
        hasReadback: false,
      })
    ).toMatchObject({
      status: "NOT_APPLICABLE",
    });
  });

  it("requires live readback evidence once CRM writes are enabled", () => {
    expect(
      callCrmReadbackAcceptance({
        writesEnabled: true,
        hasReadback: false,
      })
    ).toMatchObject({
      status: "NOT_CONFIGURED",
    });

    expect(
      callCrmReadbackAcceptance({
        writesEnabled: true,
        hasReadback: true,
        evidence: { proposalId: 42 },
      })
    ).toMatchObject({
      status: "LIVE_PROVEN",
      evidence: { proposalId: 42 },
    });
  });
});
