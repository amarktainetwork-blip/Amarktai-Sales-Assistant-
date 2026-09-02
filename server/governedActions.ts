import { randomUUID } from "node:crypto";
import type { ActionProposal } from "../drizzle/schema";
import {
  automationPolicyDecision,
  type AutomationPolicy,
} from "./automationPolicy";
import { executeApprovedCrmAction } from "./crm/executeApprovedAction";
import { getUserAutonomy } from "./autonomy";
import {
  autonomyDecision,
  type AutonomyPermission,
  type DuplicateActionState,
} from "../shared/autonomyPolicy";
import {
  claimApprovedActionProposal,
  recordActionExecution,
  reviewActionProposal,
} from "./db";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function autonomyPermissionForAction(
  actionType: string,
  payload: Record<string, unknown> = {}
): AutonomyPermission {
  if (
    actionType === "send_email" &&
    payload.communicationIntent === "reply"
  )
    return "email_replies";
  if (/^send_email/.test(actionType)) return "new_emails";
  if (/sms/.test(actionType)) return "sms";
  if (/whatsapp/.test(actionType)) return "whatsapp";
  if (/note|activity/.test(actionType)) return "crm_notes";
  if (/callback|task/.test(actionType)) return "tasks_callbacks";
  if (/contact/.test(actionType)) return "contact_updates";
  if (/opportunity|stage/.test(actionType)) return "opportunity_updates";
  if (/calendar|appointment/.test(actionType)) return "calendar_invites";
  return "sequences_followups";
}

function communicationAction(actionType: string) {
  return /^send_(?:email|sms|whatsapp)/.test(actionType);
}

function duplicateState(value: unknown): DuplicateActionState {
  return value === "clear" || value === "already_completed"
    ? value
    : "unknown";
}

export function evaluateEffectiveAutoExecution(input: {
  proposal: ActionProposal;
  policy: AutomationPolicy;
  autonomy: Awaited<ReturnType<typeof getUserAutonomy>>;
}) {
  const payload = object(input.proposal.payload);
  const route = object(payload.crmRoute);
  const verification = object(payload.actionVerification);
  const compliance = object(payload.compliance);
  const duplicate = object(payload.duplicateVerification);
  const policy = automationPolicyDecision(
    input.policy,
    input.proposal.actionType
  );
  const communication = communicationAction(input.proposal.actionType);
  const targetVerified = verification.targetVerified === true;
  const recipientVerified = !communication || verification.recipientVerified === true;
  const suppressionVerified =
    !communication || compliance.suppressionVerified === true;
  const result = autonomyDecision({
    user: input.autonomy.user,
    organisationCeiling: input.autonomy.organisationCeiling,
    permission: autonomyPermissionForAction(
      input.proposal.actionType,
      payload
    ),
    organisationAllowsAction: policy.organisationAllowsAction,
    policyRequiresReview: policy.policyRequiresReview,
    optedOut: compliance.optedOut === true,
    suppressionVerified,
    recipientVerified,
    targetVerified,
    capabilityVerified: route.routable === true,
    shadowMode: route.shadowMode === true,
    duplicateState: duplicateState(duplicate.state),
  });
  const autoExecutable =
    policy.mayAutoExecute &&
    result.allowed &&
    !result.reviewRequired;
  return {
    autoExecutable,
    allowedAfterReview:
      result.reason !== "recipient_opted_out" &&
      result.reason !== "duplicate_already_completed" &&
      result.reason !== "capability_unverified" &&
      result.reason !== "target_unverified" &&
      result.reason !== "suppression_unverified" &&
      result.reason !== "recipient_unverified" &&
      result.reason !== "shadow_mode",
    reviewRequired: !autoExecutable,
    reason: autoExecutable
      ? "authorised"
      : result.reason === "organisation_blocked" && policy.blockingReason
        ? policy.blockingReason
        : result.reason,
    autonomyReason: result.reason,
    organisationPolicyReason: policy.blockingReason,
    permission: autonomyPermissionForAction(input.proposal.actionType, payload),
    evidence: {
      targetVerified,
      recipientVerified,
      suppressionVerified,
      capabilityVerified: route.routable === true,
      shadowMode: route.shadowMode === true,
      duplicateState: duplicateState(duplicate.state),
    },
  } as const;
}

/** Reuses the existing review, claim, execution, evidence, and idempotency path. */
export async function executeAutoPreapprovedActions(input: {
  userId: number;
  organisationId: number;
  proposals: ActionProposal[];
  policy: AutomationPolicy;
}) {
  const executions: Array<Record<string, unknown>> = [];
  const autonomy = await getUserAutonomy({
    userId: input.userId,
    organisationId: input.organisationId,
  });
  for (const proposal of input.proposals) {
    const decision = evaluateEffectiveAutoExecution({
      proposal,
      policy: input.policy,
      autonomy,
    });
    if (!decision.autoExecutable) {
      executions.push({
        proposalId: proposal.id,
        success: false,
        attempted: false,
        reviewRequired: decision.allowedAfterReview,
        reason: decision.reason,
        effectivePermission: decision,
      });
      continue;
    }
    await reviewActionProposal(
      input.userId,
      input.organisationId,
      proposal.id,
      "approved"
    );
    const correlationId = randomUUID();
    const approved = await claimApprovedActionProposal({
      userId: input.userId,
      organisationId: input.organisationId,
      proposalId: proposal.id,
      correlationId,
    });
    if (!approved) {
      executions.push({
        proposalId: proposal.id,
        success: false,
        attempted: false,
        reason: "execution_claim_not_acquired",
      });
      continue;
    }
    try {
      const result = await executeApprovedCrmAction({
        organisationId: input.organisationId,
        proposal: approved,
        correlationId,
      });
      await recordActionExecution({
        userId: input.userId,
        organisationId: input.organisationId,
        proposalId: approved.id,
        correlationId,
        success: result.success,
        result,
      });
      executions.push({
        proposalId: approved.id,
        success: result.success,
        attempted: true,
        provider: result.provider,
        detail: result.detail,
        effectivePermission: decision,
      });
    } catch (error) {
      const result = {
        success: false,
        detail: error instanceof Error ? error.message : String(error),
        correlationId,
      };
      await recordActionExecution({
        userId: input.userId,
        organisationId: input.organisationId,
        proposalId: approved.id,
        correlationId,
        success: false,
        result,
      });
      executions.push({
        proposalId: approved.id,
        attempted: true,
        ...result,
        effectivePermission: decision,
      });
    }
  }
  return executions;
}
