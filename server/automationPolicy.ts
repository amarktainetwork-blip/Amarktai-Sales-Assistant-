import { eq } from "drizzle-orm";
import { organisations } from "../drizzle/schema";
import { getDb, recordAudit } from "./db";
import { canManageOrganisationForUser, requireOrganisationMembership } from "./organisation";

export type AutomationMode = "advise" | "review" | "auto_preapproved";
export type AutomationPolicy = {
  mode: AutomationMode;
  autoActionTypes: string[];
  requireReviewForCommunications: boolean;
  requireReviewForStageChanges: boolean;
};

const DEFAULT_POLICY: AutomationPolicy = {
  mode: "review",
  autoActionTypes: ["append_contact_note", "schedule_callback", "complete_active_task", "create_activity"],
  requireReviewForCommunications: true,
  requireReviewForStageChanges: true,
};

function cleanMode(value: unknown): AutomationMode {
  return value === "advise" || value === "review" || value === "auto_preapproved" ? value : DEFAULT_POLICY.mode;
}
function cleanActionTypes(value: unknown) {
  if (!Array.isArray(value)) return DEFAULT_POLICY.autoActionTypes;
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string" && /^[a-z0-9_:-]{2,80}$/i.test(item)))).slice(0, 80);
}

export function normalizeAutomationPolicy(value: unknown): AutomationPolicy {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    mode: cleanMode(source.mode),
    autoActionTypes: cleanActionTypes(source.autoActionTypes),
    requireReviewForCommunications: source.requireReviewForCommunications !== false,
    requireReviewForStageChanges: source.requireReviewForStageChanges !== false,
  };
}

export async function getAutomationPolicy(input: { userId: number; organisationId: number }) {
  await requireOrganisationMembership(input.userId, input.organisationId);
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const organisation = (await db.select().from(organisations).where(eq(organisations.id, input.organisationId)).limit(1))[0];
  if (!organisation) throw new Error("Organisation was not found.");
  return normalizeAutomationPolicy((organisation.settings as Record<string, unknown>)?.automationPolicy);
}

export async function saveAutomationPolicy(input: { userId: number; organisationId: number; policy: AutomationPolicy }) {
  const membership = await requireOrganisationMembership(input.userId, input.organisationId);
  if (!(await canManageOrganisationForUser(input.userId, membership.role))) throw new Error("Only organisation owners, managers, and platform owners can change automation policy.");
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const organisation = (await db.select().from(organisations).where(eq(organisations.id, input.organisationId)).limit(1))[0];
  if (!organisation) throw new Error("Organisation was not found.");
  const policy = normalizeAutomationPolicy(input.policy);
  const settings = { ...(organisation.settings as Record<string, unknown>), automationPolicy: policy };
  await db.update(organisations).set({ settings }).where(eq(organisations.id, input.organisationId));
  await recordAudit({ userId: input.userId, eventType: "automation_policy_updated", entityType: "organisation", entityId: String(input.organisationId), summary: `Automation policy changed to ${policy.mode}.`, metadata: { mode: policy.mode, autoActionTypes: policy.autoActionTypes, requireReviewForCommunications: policy.requireReviewForCommunications, requireReviewForStageChanges: policy.requireReviewForStageChanges } });
  return policy;
}

const COMMUNICATION_ACTIONS = new Set(["send_email", "send_email_template", "send_sms", "send_sms_template", "send_whatsapp", "send_whatsapp_template"]);
const STAGE_ACTIONS = new Set(["update_current_opportunity", "update_opportunity", "update_contact_status"]);

export function mayAutoExecute(policy: AutomationPolicy, actionType: string) {
  if (policy.mode !== "auto_preapproved") return false;
  if (!policy.autoActionTypes.includes(actionType)) return false;
  if (policy.requireReviewForCommunications && COMMUNICATION_ACTIONS.has(actionType)) return false;
  if (policy.requireReviewForStageChanges && STAGE_ACTIONS.has(actionType)) return false;
  return true;
}
