import type { ManagerFindingInput } from "./db";

type Snapshot = {
  proposals: Array<{ id: number; workflowRunId: number; state: string; targetLabel: string; title: string; createdAt: Date; executionResult: Record<string, unknown> | null }>;
  callbacks: Array<{ id: number; state: string; leadLabel: string; title: string; dueAt: Date | null }>;
  runs: Array<{ id: number; status: string; workflowKey: string; leadLabel: string; updatedAt: Date }>;
  calls: Array<{ id: number; status: string; leadLabel: string; updatedAt: Date }>;
};

export function buildManagerAssuranceFindings(snapshot: Snapshot, now = new Date()): ManagerFindingInput[] {
  const findings: ManagerFindingInput[] = [];
  for (const proposal of snapshot.proposals.filter(item => item.state === "blocked")) {
    findings.push({ findingKey: `blocked-proposal:${proposal.id}`, severity: "high", title: "Blocked action requires manager review", detail: `${proposal.title} for ${proposal.targetLabel} is blocked. Review the retained reason and correct the prerequisite before preparing new work.`, targetType: "action_proposal", targetId: String(proposal.id), metadata: { state: proposal.state, executionResult: proposal.executionResult } });
  }
  for (const proposal of snapshot.proposals.filter(item => item.state === "executed" && (item.executionResult?.evidence as { availability?: string } | undefined)?.availability !== "captured")) {
    findings.push({ findingKey: `missing-crm-evidence:${proposal.id}`, severity: "high", title: "Executed CRM work has no retained evidence", detail: `${proposal.title} for ${proposal.targetLabel} is marked executed but does not have a captured evidence record. Confirm the CRM outcome manually before relying on it.`, targetType: "action_proposal", targetId: String(proposal.id), metadata: { executionResult: proposal.executionResult } });
  }
  for (const proposal of snapshot.proposals.filter(item => item.state === "review_required" && now.getTime() - item.createdAt.getTime() > 86_400_000)) {
    findings.push({ findingKey: `stale-review:${proposal.id}`, severity: "normal", title: "Review decision is ageing", detail: `${proposal.title} for ${proposal.targetLabel} has been waiting for a human decision for more than 24 hours.`, targetType: "action_proposal", targetId: String(proposal.id), metadata: { createdAt: proposal.createdAt.toISOString() } });
  }
  for (const callback of snapshot.callbacks.filter(item => item.state === "open" && item.dueAt && item.dueAt < now)) {
    findings.push({ findingKey: `overdue-callback:${callback.id}`, severity: "high", title: "Overdue callback needs ownership", detail: `${callback.title} for ${callback.leadLabel} is overdue. Confirm the CRM context and prepare the next approved action.`, targetType: "callback_task", targetId: String(callback.id), metadata: { dueAt: callback.dueAt?.toISOString() } });
  }
  for (const run of snapshot.runs.filter(item => item.status === "failed" || item.status === "blocked")) {
    findings.push({ findingKey: `workflow-exception:${run.id}`, severity: "high", title: "Workflow has an unresolved exception", detail: `${run.workflowKey.replaceAll("_", " ")} for ${run.leadLabel} is ${run.status}. Verify the missing evidence or CRM prerequisite before continuing.`, targetType: "workflow_run", targetId: String(run.id), metadata: { status: run.status } });
  }
  for (const run of snapshot.runs.filter(item => item.status === "completed")) {
    const unresolved = snapshot.proposals.filter(proposal => proposal.workflowRunId === run.id && !["executed", "skipped", "blocked"].includes(proposal.state));
    if (unresolved.length) findings.push({ findingKey: `incomplete-completed-workflow:${run.id}`, severity: "high", title: "Completed workflow still has unresolved proposals", detail: `${run.workflowKey.replaceAll("_", " ")} for ${run.leadLabel} is marked completed while ${unresolved.length} proposal${unresolved.length === 1 ? " remains" : "s remain"} unresolved. Reconcile the workflow status before treating it as complete.`, targetType: "workflow_run", targetId: String(run.id), metadata: { unresolvedProposalIds: unresolved.map(item => item.id) } });
  }
  for (const call of snapshot.calls.filter(item => item.status === "ready_for_review" && now.getTime() - item.updatedAt.getTime() > 86_400_000)) {
    findings.push({ findingKey: `unreviewed-call:${call.id}`, severity: "normal", title: "Call summary awaits review", detail: `The call summary for ${call.leadLabel} has not been reviewed within 24 hours. Confirm factual notes and the next step.`, targetType: "call_session", targetId: String(call.id), metadata: { updatedAt: call.updatedAt.toISOString() } });
  }
  if (!findings.length) findings.push({ findingKey: "assurance-clear", severity: "info", title: "No evidence-based exceptions found", detail: "The manager check found no overdue callback, blocked proposal, stale review, failed workflow, or ageing call summary in the retained workspace records.", metadata: { checkedAt: now.toISOString() } });
  return findings;
}
