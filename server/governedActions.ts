import { randomUUID } from "node:crypto";
import type { ActionProposal } from "../drizzle/schema";
import { mayAutoExecute, type AutomationPolicy } from "./automationPolicy";
import { executeApprovedCrmAction } from "./crm/executeApprovedAction";
import {
  claimApprovedActionProposal,
  recordActionExecution,
  reviewActionProposal,
} from "./db";

/** Reuses the existing review, claim, execution, evidence, and idempotency path. */
export async function executeAutoPreapprovedActions(input: {
  userId: number;
  organisationId: number;
  proposals: ActionProposal[];
  policy: AutomationPolicy;
}) {
  const executions: Array<Record<string, unknown>> = [];
  if (input.policy.mode !== "auto_preapproved") return executions;
  for (const proposal of input.proposals) {
    const route = (proposal.payload as Record<string, unknown>).crmRoute as
      | { routable?: boolean; shadowMode?: boolean }
      | undefined;
    if (
      !route?.routable ||
      route.shadowMode ||
      !mayAutoExecute(input.policy, proposal.actionType)
    )
      continue;
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
    if (!approved) continue;
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
        provider: result.provider,
        detail: result.detail,
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
      executions.push({ proposalId: approved.id, ...result });
    }
  }
  return executions;
}
