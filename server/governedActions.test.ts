import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionProposal } from "../drizzle/schema";
import {
  normalizeAutonomySettings,
  reviewEverythingAutonomy,
} from "../shared/autonomyPolicy";
const mocks = vi.hoisted(() => ({
  getUserAutonomy: vi.fn(),
  getAutomationPolicy: vi.fn(),
  review: vi.fn(),
  claim: vi.fn(),
  execute: vi.fn(),
  record: vi.fn(),
  returnForReview: vi.fn(),
  resolve: vi.fn(),
}));
vi.mock("./autonomy", () => ({ getUserAutonomy: mocks.getUserAutonomy }));
vi.mock("./automationPolicy", async () => ({
  ...(await vi.importActual<typeof import("./automationPolicy")>(
    "./automationPolicy"
  )),
  getAutomationPolicy: mocks.getAutomationPolicy,
}));
vi.mock("./db", () => ({
  getDb: vi.fn(),
  recordAudit: vi.fn(),
  reviewActionProposal: mocks.review,
  claimApprovedActionProposal: mocks.claim,
  recordActionExecution: mocks.record,
  returnClaimedActionForReview: mocks.returnForReview,
}));
vi.mock("./crm/guardedActionExecution", () => ({
  executeGuardedApprovedCrmAction: mocks.execute,
}));
vi.mock("./salesWork", () => ({
  resolveSalesWorkAfterVerifiedAction: mocks.resolve,
}));
import { normalizeAutomationPolicy } from "./automationPolicy";
import { executeAutoPreapprovedActions } from "./governedActions";
function proposal(actionType = "send_sms", id = 1): ActionProposal {
  return {
    id,
    userId: 7,
    organisationId: 4,
    actionType,
    state: "review_required",
    payload: {
      reviewRequired: true,
      crmRoute: { routable: true },
      actionVerification: { targetVerified: true, recipientVerified: true },
      compliance: { suppressionVerified: true, optedOut: false },
      duplicateVerification: { state: "clear" },
    },
  } as ActionProposal;
}
function policy(actionType = "send_sms") {
  return normalizeAutomationPolicy({
    mode: "auto_preapproved",
    autoActionTypes: [actionType],
    requireReviewForCommunications: false,
    requireReviewForStageChanges: false,
    schedule: { mode: "continuous", days: [0, 1, 2, 3, 4, 5, 6] },
    safety: { quietHoursEnabled: false },
  });
}
const full = () => ({ user: normalizeAutonomySettings({ mode: "full" }) });
const review = () => ({ user: reviewEverythingAutonomy() });
const run = (proposals = [proposal()]) =>
  executeAutoPreapprovedActions({
    userId: 7,
    organisationId: 4,
    proposals,
    policy: policy(),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getAutomationPolicy.mockResolvedValue(policy());
  mocks.getUserAutonomy.mockResolvedValue(review());
  mocks.claim.mockImplementation(async ({ proposalId }) => ({
    ...proposal("send_sms", proposalId),
    state: "approved",
  }));
  mocks.execute.mockResolvedValue({
    success: true,
    provider: "test",
    detail: "Mock only",
  });
  mocks.resolve.mockResolvedValue(false);
});
describe("user authority at the automatic execution boundary", () => {
  it.each([
    "send_email",
    "send_email_template",
    "send_sms",
    "send_sms_template",
    "send_whatsapp",
    "send_whatsapp_template",
    "schedule_callback",
    "append_contact_note",
    "update_opportunity",
    "create_appointment",
    "apply_sequence",
  ])(
    "keeps %s in review by default even when the organisation allows automation",
    async actionType => {
      mocks.getAutomationPolicy.mockResolvedValue(policy(actionType));
      const result = await run([proposal(actionType)]);
      expect(result[0]).toMatchObject({ attempted: false });
      expect(mocks.review).not.toHaveBeenCalled();
      expect(mocks.claim).not.toHaveBeenCalled();
      expect(mocks.execute).not.toHaveBeenCalled();
    }
  );
  it("does not grant SMS authority when the user only enabled email", async () => {
    mocks.getUserAutonomy.mockResolvedValue({
      user: normalizeAutonomySettings({
        mode: "custom",
        permissions: { new_emails: true },
      }),
    });
    await run();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("executes the expressly authorised action through the claim boundary", async () => {
    mocks.getUserAutonomy.mockResolvedValue({
      user: normalizeAutonomySettings({
        mode: "custom",
        permissions: { sms: true },
      }),
    });
    await run();
    expect(mocks.review).toHaveBeenCalledOnce();
    expect(mocks.claim).toHaveBeenCalledOnce();
    expect(mocks.execute).toHaveBeenCalledOnce();
  });
  it("returns to review without sending if user authority is revoked after claim", async () => {
    mocks.getUserAutonomy
      .mockResolvedValueOnce(full())
      .mockResolvedValue(review());
    const result = await run();
    expect(mocks.claim).toHaveBeenCalledOnce();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.returnForReview).toHaveBeenCalledOnce();
    expect(result[0]).toMatchObject({ attempted: false, reviewRequired: true });
  });
  it("does not reuse authority from an earlier action", async () => {
    mocks.getUserAutonomy
      .mockResolvedValueOnce(full())
      .mockResolvedValueOnce(full())
      .mockResolvedValue(review());
    const result = await run([
      proposal("send_sms", 1),
      proposal("send_sms", 2),
    ]);
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(result[1]).toMatchObject({ attempted: false });
  });
  it("uses current organisation policy instead of a stale caller snapshot", async () => {
    mocks.getUserAutonomy.mockResolvedValue(full());
    mocks.getAutomationPolicy.mockResolvedValue(
      normalizeAutomationPolicy({
        schedule: { days: [0, 1, 2, 3, 4, 5, 6] },
        safety: { quietHoursEnabled: false },
      })
    );
    await run();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.review).not.toHaveBeenCalled();
  });
  it("rejects another salesperson's proposal", async () => {
    await expect(
      executeAutoPreapprovedActions({
        userId: 8,
        organisationId: 4,
        proposals: [proposal()],
        policy: policy(),
      })
    ).rejects.toThrow("AUTOMATION_PROPOSAL_SCOPE_MISMATCH");
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
