import type { ChatMessage } from "./genx";
import { getManagerWatchtower } from "./managerWatchtower";
import { getSalesWatchtower } from "./salesCommsWatchtower";

export const GOVERNED_EVIDENCE_AGENT_KEYS = [
  "sales_comms_tracker",
  "promise_tracker",
  "revenue_leakage",
  "relationship_health",
  "pipeline_hygiene",
  "attention_engine",
  "manager_watchtower",
] as const;

export type GovernedEvidenceAgentKey =
  (typeof GOVERNED_EVIDENCE_AGENT_KEYS)[number];

const governedEvidenceAgents = new Set<string>(GOVERNED_EVIDENCE_AGENT_KEYS);

export function isGovernedEvidenceAgent(
  agentKey: string
): agentKey is GovernedEvidenceAgentKey {
  return governedEvidenceAgents.has(agentKey);
}

function evidenceResponse(content: string) {
  return {
    content,
    provider: "workspace_evidence" as const,
    usage: {},
    creditsCharged: 0,
  };
}

/**
 * Agent Desk dispatcher for the seven CRM-evidence specialists.
 *
 * These answers are built from the synchronized organisation evidence model,
 * not from the generic chat context. The Promise Tracker may invoke the bounded
 * extraction call inside salesCommsWatchtower, but that internal call carries
 * an explicit billing context and therefore cannot re-enter this dispatcher.
 */
export async function runGovernedEvidenceAgent(input: {
  userId: number;
  organisationId: number;
  agentKey: GovernedEvidenceAgentKey;
  messages: ChatMessage[];
}) {
  if (input.agentKey === "manager_watchtower") {
    const manager = await getManagerWatchtower({
      userId: input.userId,
      organisationId: input.organisationId,
    });
    return evidenceResponse(
      manager.summary.peopleNeedingAttention
        ? `${manager.summary.peopleNeedingAttention} mapped salesperson${manager.summary.peopleNeedingAttention === 1 ? " needs" : "s need"} attention. The watchtower is ranked from synchronized CRM exceptions only.`
        : "No mapped salesperson currently has a watchtower exception in synchronized CRM evidence."
    );
  }

  const watchtower = await getSalesWatchtower({
    userId: input.userId,
    organisationId: input.organisationId,
    includePromises: input.agentKey === "promise_tracker",
  });

  if (input.agentKey === "sales_comms_tracker") {
    const waiting = watchtower.salesComms.filter(item => item.waitingOnUs).length;
    return evidenceResponse(
      waiting
        ? `${waiting} customer${waiting === 1 ? " is" : "s are"} currently waiting on the team according to synchronized communication evidence.`
        : "No synchronized customer communication is currently marked as waiting on the team."
    );
  }

  if (input.agentKey === "promise_tracker") {
    const overdue = watchtower.promises.filter(item => item.overdue).length;
    return evidenceResponse(
      watchtower.promiseAnalysis === "unavailable"
        ? "The synchronized communication evidence is available, but promise interpretation is temporarily unavailable. No commitments were guessed."
        : `${watchtower.promises.length} explicit commitment${watchtower.promises.length === 1 ? "" : "s"} found${overdue ? `, including ${overdue} overdue` : ""}.`
    );
  }

  if (input.agentKey === "revenue_leakage") {
    return evidenceResponse(
      watchtower.revenueLeakage.length
        ? `${watchtower.revenueLeakage.length} evidence-backed revenue-risk item${watchtower.revenueLeakage.length === 1 ? "" : "s"} need attention.`
        : "No revenue-leakage exception is currently visible in synchronized CRM evidence."
    );
  }

  if (input.agentKey === "relationship_health") {
    const highRisk = watchtower.customerHealth.filter(
      item => item.status === "high_risk"
    ).length;
    return evidenceResponse(
      highRisk
        ? `${highRisk} active deal${highRisk === 1 ? " is" : "s are"} currently high risk based on explainable CRM evidence.`
        : "No active deal is currently classified high risk by the operational health rules."
    );
  }

  if (input.agentKey === "pipeline_hygiene") {
    return evidenceResponse(
      watchtower.pipelineHygiene.length
        ? `${watchtower.pipelineHygiene.length} active pipeline record${watchtower.pipelineHygiene.length === 1 ? " has" : "s have"} a hygiene issue to review.`
        : "No active pipeline hygiene exception is currently visible in synchronized CRM evidence."
    );
  }

  return evidenceResponse(
    watchtower.attention.length
      ? `I ranked ${watchtower.attention.length} customer attention item${watchtower.attention.length === 1 ? "" : "s"} from the current CRM evidence. The first item is the strongest operational exception, not an autonomous instruction to contact the customer.`
      : "There is no current CRM exception requiring a ranked next action."
  );
}
