import type { Express, NextFunction, Request, Response } from "express";
import { requireLocalHttpContext } from "./httpAuth";
import { prepareGovernedAssistantRequest } from "./governedAssistantEntry";
import { routeSalesCommand } from "./supervisor";

function latestUserCommand(value: unknown) {
  if (!Array.isArray(value)) return "";
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const item = value[index];
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    if (row.role !== "user") continue;
    const content = typeof row.content === "string" ? row.content.trim() : "";
    if (content) return content.slice(0, 12_000);
  }
  return "";
}

export function isGovernedAssistantActionRequest(command: string) {
  const route = routeSalesCommand(command);
  if (route.intent === "workflow") return true;
  if (/\b(callback|follow[- ]?up task|remind me)\b/i.test(command)) return true;
  return /\b(send|draft|write|prepare|reply|respond)\b[^\n]{0,160}\b(e-?mail|email|sms|text message|whats\s*app)\b|\b(e-?mail|email|sms|text message|whats\s*app)\b[^\n]{0,160}\b(send|draft|write|prepare|reply|respond)\b/i.test(
    command
  );
}

/**
 * Intercepts only external-action intents. Everything else continues to the
 * conversational Assistant route. CRM-side Assistant calls the same canonical
 * governed entry, so both surfaces share customer resolution, configuration,
 * routing, policy, review and execution preparation.
 */
export function registerAssistantActionRoute(app: Express) {
  app.post(
    "/api/assistant",
    async (req: Request, res: Response, next: NextFunction) => {
      const command = latestUserCommand(req.body?.messages);
      if (!command || !isGovernedAssistantActionRequest(command)) return next();
      try {
        const { userId, membership } = await requireLocalHttpContext(req);
        const contactId =
          Number.isInteger(req.body?.contactId) && Number(req.body.contactId) > 0
            ? Number(req.body.contactId)
            : undefined;
        const result = await prepareGovernedAssistantRequest({
          userId,
          organisationId: membership.organisationId,
          contactId,
          command,
        });
        return res.json({
          content: result.summary,
          reviewRequired: result.state === "prepared_for_review",
          workflowRunId: result.workflowRunId,
          proposalCount: result.proposalCount,
          ...(result.state === "prepared_for_review"
            ? {
                suggestedAction: {
                  label: "Review proposed action",
                  path: "/reviews",
                },
              }
            : {}),
          ...(result.data?.actionPreview
            ? { actionPreview: result.data.actionPreview }
            : {}),
          actionState: result.state,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(
          JSON.stringify({
            event: "governed_assistant_action_failed",
            detail: detail.slice(0, 300),
          })
        );
        return res.status(400).json({
          error:
            detail && !/token|secret|password|cookie|authorization/i.test(detail)
              ? detail.slice(0, 500)
              : "The requested action could not be prepared safely. Nothing was changed.",
        });
      }
    }
  );
}
