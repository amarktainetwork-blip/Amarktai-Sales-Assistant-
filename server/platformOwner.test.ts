import { describe, expect, it } from "vitest";
import { aiUsageMetadata, assessAiCreditDebit } from "./aiCredits";
import { localAdminPlatformOwnerEnabled } from "./db";
import { assertEntitledFeature, assertEntitlementLimit } from "./entitlements/guard";
import { hasOrganisationAccess } from "./organisationAccess";
import { buildWorkflowPlan } from "./workflowRules";

describe("platform-owner boundaries", () => {
  it("blocks an ordinary zero-credit user but permits an exempt platform owner", () => {
    expect(() => assessAiCreditDebit([], 1, "normal")).toThrow("0 AI Credits");
    expect(assessAiCreditDebit([], 1, "owner", true)).toMatchObject({ billingExempt: true, balance: 0 });
  });

  it("records provider usage without debiting the platform-owner wallet", () => {
    expect(aiUsageMetadata({ credits: 3, feature: "assistant", providerUsage: { totalTokens: 21 }, billingExempt: true })).toMatchObject({
      creditsDelta: 0,
      transactionType: "usage_exempt",
      providerUsage: { totalTokens: 21 },
    });
  });

  it("bypasses plan entitlements only when the durable owner flag is supplied", () => {
    expect(() => assertEntitledFeature(null, "advanced_automation")).toThrow("ENTITLEMENT_INACTIVE");
    expect(() => assertEntitledFeature(null, "advanced_automation", true)).not.toThrow();
    expect(() => assertEntitlementLimit(null, "connected_systems", 100, true)).not.toThrow();
  });

  it("does not bypass tenant membership or review-first action policy", () => {
    expect(hasOrganisationAccess(null, 9, 1)).toBe(false);
    expect(buildWorkflowPlan({ workflowKey: "first_contact", leadLabel: "Sarah" }).actions.every(action => action.payload.reviewRequired === true)).toBe(true);
  });

  it("enables the guided bootstrap only through the explicit production setting", () => {
    expect(localAdminPlatformOwnerEnabled("true")).toBe(true);
    expect(localAdminPlatformOwnerEnabled("false")).toBe(false);
  });
});
