import type { Express, Request, Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { parse as parseCookieHeader } from "cookie";
import { COOKIE_NAME } from "@shared/const";
import { getLocalSessionUser, isLocalAuthMode } from "./localAuth";
import { sdk } from "./_core/sdk";
import { TWO_FACTOR_COOKIE, verifyTwoFactorSession } from "./twoFactor";
import { ensureDefaultOrganisation } from "./organisation";
import { listConnectedSystemsForUser } from "./connectedSystems";
import { routeConnectedSystemActions } from "./crmRouter";
import { createWorkflowRun, getApprovedActionProposal, listActionProposals, recordActionExecution, reviewActionProposal } from "./db";
import { executeApprovedCrmAction } from "./crm/executeApprovedAction";
import { getAutomationPolicy, mayAutoExecute, normalizeAutomationPolicy, saveAutomationPolicy } from "./automationPolicy";

const ACTION_TYPES = [
  "verify_contact_context", "append_contact_note", "schedule_callback", "complete_active_task",
  "update_contact_status", "update_contact", "create_contact", "create_company",
  "update_current_opportunity", "update_opportunity", "create_opportunity", "create_activity",
  "send_email", "send_email_template", "send_sms", "send_sms_template", "send_whatsapp", "send_whatsapp_template",
  "apply_sequence", "custom_crm_action",
] as const;
type ActionType = (typeof ACTION_TYPES)[number];

type PreparedSalesAction = {
  actionType: ActionType;
  title: string;
  targetLabel: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
};

async function authenticated(req: Request) {
  const cookies = parseCookieHeader(req.headers.cookie ?? "");
  const user = isLocalAuthMode() ? await getLocalSessionUser(cookies[COOKIE_NAME]) : await sdk.authenticateRequest(req);
  if (!user || ("isCron" in user && user.isCron)) throw new Error("AUTH_REQUIRED");
  if (!(await verifyTwoFactorSession(cookies[TWO_FACTOR_COOKIE], user.id))) throw new Error("TWO_FACTOR_REQUIRED");
  const membership = await ensureDefaultOrganisation(user.id);
  return { userId: user.id, membership };
}

function sendError(res: Response, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  if (detail === "AUTH_REQUIRED") return res.status(401).json({ error: "Authentication is required." });
  if (detail === "TWO_FACTOR_REQUIRED") return res.status(403).json({ error: "Second-factor verification is required." });
  console.error(JSON.stringify({ event: "sales_automation_error", detail: detail.slice(0, 500) }));
  return res.status(400).json({ error: detail.slice(0, 500) || "Sales automation operation failed." });
}

function cleanAction(value: unknown, index: number): PreparedSalesAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Action ${index + 1} must be an object.`);
  const source = value as Record<string, unknown>;
  const actionType = String(source.actionType || "") as ActionType;
  if (!ACTION_TYPES.includes(actionType)) throw new Error(`Action ${index + 1} uses unsupported type '${actionType}'.`);
  const targetLabel = String(source.targetLabel || source.externalId || "").trim().slice(0, 180);
  if (!targetLabel) throw new Error(`Action ${index + 1} requires a target label or external record ID.`);
  const title = String(source.title || actionType.replaceAll("_", " ")).trim().slice(0, 220);
  const payload = source.payload && typeof source.payload === "object" && !Array.isArray(source.payload) ? { ...(source.payload as Record<string, unknown>) } : {};
  if (source.externalId !== undefined && payload.externalId === undefined) payload.externalId = String(source.externalId);
  if (source.contactExternalId !== undefined && payload.contactExternalId === undefined) payload.contactExternalId = String(source.contactExternalId);
  if (source.opportunityExternalId !== undefined && payload.opportunityExternalId === undefined) payload.opportunityExternalId = String(source.opportunityExternalId);
  const encoded = JSON.stringify(payload);
  if (encoded.length > 80_000) throw new Error(`Action ${index + 1} payload is too large.`);
  const fingerprint = createHash("sha256").update(`${actionType}\0${targetLabel}\0${encoded}`).digest("hex").slice(0, 28);
  return { actionType, title, targetLabel, idempotencyKey: String(source.idempotencyKey || `generic:${fingerprint}`).slice(0, 255), payload: { reviewRequired: true, duplicateProtection: "Verify the target state immediately before execution and do not repeat a completed external action.", ...payload } };
}

export function registerSalesAutomationRoutes(app: Express) {
  app.get("/api/sales-automation/capabilities", async (req, res) => {
    try {
      const { userId, membership } = await authenticated(req);
      const [policy, systems] = await Promise.all([getAutomationPolicy({ userId, organisationId: membership.organisationId }), listConnectedSystemsForUser(userId, membership.organisationId)]);
      return res.json({ policy, actionTypes: ACTION_TYPES, systems: systems.map(system => ({ id: system.id, provider: system.provider, displayName: system.displayName, status: system.status, verifiedCapabilities: system.verifiedCapabilities })) });
    } catch (error) { return sendError(res, error); }
  });

  app.put("/api/sales-automation/policy", async (req, res) => {
    try {
      const { userId, membership } = await authenticated(req);
      const policy = normalizeAutomationPolicy(req.body);
      return res.json({ policy: await saveAutomationPolicy({ userId, organisationId: membership.organisationId, policy }) });
    } catch (error) { return sendError(res, error); }
  });

  app.post("/api/sales-automation/prepare", async (req, res) => {
    try {
      const { userId, membership } = await authenticated(req);
      const supplied = Array.isArray(req.body?.actions) ? req.body.actions : req.body?.action ? [req.body.action] : [];
      if (!supplied.length || supplied.length > 40) throw new Error("Supply between one and forty sales actions.");
      const actions: PreparedSalesAction[] = supplied.map(cleanAction);
      const systems = await listConnectedSystemsForUser(userId, membership.organisationId);
      const routed = routeConnectedSystemActions(actions, systems) as PreparedSalesAction[];
      const policy = await getAutomationPolicy({ userId, organisationId: membership.organisationId });
      if (policy.mode === "advise") return res.json({ mode: policy.mode, persisted: false, actions: routed, blockedActionCount: routed.filter(action => !((action.payload.crmRoute as { routable?: boolean } | undefined)?.routable)).length });

      const workflowRunId = await createWorkflowRun({ userId, workflowKey: "generic_sales_automation", leadLabel: String(req.body?.label || actions[0].targetLabel).slice(0, 160), payload: { source: "generic_sales_automation", actionCount: actions.length }, verificationSummary: "Amarktai routed these actions only through backend-verified organisation CRM capabilities. External actions require review unless explicitly pre-approved by organisation policy.", actions: routed });
      const proposals = await listActionProposals(userId, workflowRunId);
      const executions: Array<Record<string, unknown>> = [];
      if (policy.mode === "auto_preapproved") {
        for (const proposal of proposals) {
          const route = (proposal.payload as Record<string, unknown>).crmRoute as { routable?: boolean } | undefined;
          if (!route?.routable || !mayAutoExecute(policy, proposal.actionType)) continue;
          await reviewActionProposal(userId, proposal.id, "approved");
          const approved = await getApprovedActionProposal(userId, proposal.id);
          if (!approved) continue;
          try {
            const result = await executeApprovedCrmAction({ organisationId: membership.organisationId, proposal: approved, correlationId: randomUUID() });
            await recordActionExecution({ userId, proposalId: approved.id, success: result.success, result });
            executions.push({ proposalId: approved.id, success: result.success, provider: result.provider, detail: result.detail });
          } catch (error) {
            const result = { success: false, detail: error instanceof Error ? error.message : String(error), correlationId: randomUUID() };
            await recordActionExecution({ userId, proposalId: approved.id, success: false, result });
            executions.push({ proposalId: approved.id, ...result });
          }
        }
      }
      return res.json({ mode: policy.mode, persisted: true, workflowRunId, proposalCount: proposals.length, blockedActionCount: proposals.filter(proposal => proposal.state === "blocked").length, autoExecutions: executions });
    } catch (error) { return sendError(res, error); }
  });
}
