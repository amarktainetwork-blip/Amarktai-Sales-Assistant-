import type { ProposedAction, WorkflowPlan } from "./workflowRules";

type ActivePlaybook = { id: number; title: string; description: string; agentKey: string; requiredCapabilities: string[]; reviewRequired: boolean; status: "draft" | "active" | "paused" };

const actionByCapability: Record<string, { actionType: string; title: (title: string) => string; payload: Record<string, unknown> }> = {
  contacts: { actionType: "update_contact_status", title: title => `Review contact status for ${title}`, payload: { guardrail: "Use only the status and transition approved in this playbook review." } },
  tasks: { actionType: "schedule_callback", title: title => `Review task or callback change for ${title}`, payload: { taskTitle: "Configured playbook task", guardrail: "Do not create a duplicate task or override a future callback." } },
  opportunities: { actionType: "update_current_opportunity", title: title => `Review current opportunity update for ${title}`, payload: { guardrail: "Update only the current open opportunity; historical opportunities remain untouched." } },
  notes: { actionType: "append_contact_note", title: title => `Review CRM notes for ${title}`, payload: { guardrail: "Save only factual information supplied in the playbook preparation." } },
  activities: { actionType: "apply_sequence", title: title => `Review activity sequence for ${title}`, payload: { guardrail: "Apply only a configured approved sequence after duplicate checks." } },
  email: { actionType: "send_email_template", title: title => `Review approved email for ${title}`, payload: { requireSavedSubject: true, guardrail: "Use only the configured approved template and do not send a blank subject." } },
  calendar: { actionType: "schedule_callback", title: title => `Review calendar or callback action for ${title}`, payload: { taskTitle: "Configured playbook calendar action", guardrail: "Verify availability, office hours, and duplicate bookings before execution." } },
};

function proposal(leadLabel: string, playbook: ActivePlaybook, suffix: string, action: { actionType: string; title: (title: string) => string; payload: Record<string, unknown> }): ProposedAction {
  return { actionType: action.actionType, title: action.title(playbook.title), targetLabel: leadLabel, idempotencyKey: `${leadLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}:playbook-${playbook.id}:${suffix}`, payload: { reviewRequired: true, duplicateProtection: "Check the external record immediately before execution; skip if this exact action is already complete.", playbookId: playbook.id, playbookTitle: playbook.title, agentKey: playbook.agentKey, ...action.payload } };
}

export function buildPlaybookPlan(input: { playbook: ActivePlaybook; leadLabel: string; factualContext: string }): WorkflowPlan {
  if (input.playbook.status !== "active" || !input.playbook.reviewRequired) throw new Error("Only active review-first playbooks can prepare work.");
  if (!input.factualContext.trim()) throw new Error("Provide factual context before preparing a company playbook.");
  const actions: ProposedAction[] = [{ actionType: "verify_contact_context", title: "Review contact history and existing tasks", targetLabel: input.leadLabel, idempotencyKey: `${input.leadLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}:playbook-${input.playbook.id}:context`, payload: { reviewRequired: true, duplicateProtection: "Verify existing CRM context before every playbook action.", playbookId: input.playbook.id, requiredChecks: ["existing tasks", "conversation history", "current open opportunity", "consent and exclusions"], factualContext: input.factualContext.trim() } }];
  for (const capability of input.playbook.requiredCapabilities) {
    const mapping = actionByCapability[capability];
    if (mapping) actions.push(proposal(input.leadLabel, input.playbook, capability, mapping));
  }
  if (actions.length === 1) throw new Error("The active playbook has no mapped reviewable CRM capability.");
  return { verificationSummary: `${input.playbook.title} was prepared from factual context. Review CRM history, current work, consent, duplicate risks, and every proposed external action before approval. ${input.playbook.description}`, actions };
}
