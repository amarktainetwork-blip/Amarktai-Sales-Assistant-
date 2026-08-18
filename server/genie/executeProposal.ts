import type { ActionProposal } from "../../drizzle/schema";
import { runSavedGenieScript, type GenieScriptName } from "./savedScripts";

const proposalToScript: Record<string, GenieScriptName> = {
  verify_contact_context: "read_candidate_history",
  send_sms_template: "send_template_sms",
  send_email_template: "send_template_email",
  send_whatsapp_template: "send_template_whatsapp",
  append_contact_note: "add_note",
  complete_active_task: "complete_active_task",
  schedule_callback: "create_next_task",
  update_current_opportunity: "update_current_opportunity",
  update_contact_status: "update_contact_status",
  apply_sequence: "apply_sequence",
};

export async function executeApprovedGenieProposal(proposal: ActionProposal) {
  const script = proposalToScript[proposal.actionType];
  if (!script) throw new Error(`There is no saved Genie script mapped to '${proposal.actionType}'. Do not improvise a browser action.`);
  const payload = proposal.payload as Record<string, unknown>;
  if (payload.reviewRequired !== true) throw new Error("This proposal does not carry the required review-first guardrail.");
  return runSavedGenieScript(script, {
    leadLabel: proposal.targetLabel,
    proposalId: proposal.id,
    ...payload,
  });
}
