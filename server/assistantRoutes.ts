import type { Express, Response } from "express";
import {
  createWorkflowRun,
  getUserById,
  getAssistantOperationalContext,
  recordAudit,
  searchApprovedKnowledge,
} from "./db";
import { requireLocalHttpContext } from "./httpAuth";
import { routeSalesCommand } from "./supervisor";
import { getTodayWork } from "./today";
import { getWorkingContextForContact } from "./liveCalls/context";
import { runGenxAgent, type ChatMessage } from "./genx";
import { listConnectedSystemsForUser } from "./connectedSystems";
import { planAssistantCrmBatchInstruction } from "./crm/assistantBatchExecution";
import { routeConnectedSystemActions } from "./crmRouter";
import {
  createAssistantMemory,
  isSafeAssistantMemory,
  listRelevantAssistantMemories,
  parseRememberCommand,
} from "./memory";

const MAX_MESSAGES = 18;
const MAX_MESSAGE_CHARS = 12_000;

type AssistantAction = {
  label: string;
  path: string;
};

type PublicAssistantResponse = {
  content: string;
  suggestedAction?: AssistantAction;
  reviewRequired?: boolean;
};

function cleanMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) throw new Error("ASSISTANT_MESSAGES_REQUIRED");
  const messages = value.slice(-MAX_MESSAGES).map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error("ASSISTANT_MESSAGE_INVALID");
    const candidate = item as Record<string, unknown>;
    const role = candidate.role === "assistant" ? "assistant" : "user";
    const content = String(candidate.content || "")
      .trim()
      .slice(0, MAX_MESSAGE_CHARS);
    if (!content) throw new Error("ASSISTANT_MESSAGE_EMPTY");
    return { role, content } as ChatMessage;
  });
  if (!messages.length) throw new Error("ASSISTANT_MESSAGES_REQUIRED");
  return messages;
}

function customerMessage(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error || "");
  if (/TWO_FACTOR_REQUIRED/i.test(detail))
    return "Please finish your Amarktai sign-in verification and try again.";
  if (/AUTH_REQUIRED/i.test(detail)) return "Please sign in to continue.";
  if (/credit/i.test(detail))
    return "Your organisation needs more AI credits before I can use intelligence for that request. Your CRM data and daily work remain available.";
  if (/GenX|intelligence model|not configured|advertised/i.test(detail))
    return "My AI guidance is temporarily unavailable. I can still show your tasks, priorities, reminders, callbacks and CRM workspace.";
  return "I couldn't complete that request just now. Nothing was changed. Please try again.";
}

function dateLabel(value: unknown) {
  if (!value) return "no due time";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.valueOf())) return "due date unavailable";
  return date.toLocaleString("en-ZA", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function listLines<T>(
  items: T[],
  render: (item: T, index: number) => string,
  maximum = 8
) {
  return items.slice(0, maximum).map(render).join("\n");
}

function deterministicTodayAnswer(
  query: string,
  today: Awaited<ReturnType<typeof getTodayWork>>
): PublicAssistantResponse | undefined {
  const normalized = query.toLowerCase();

  if (/overdue.*task|task.*overdue|what.*overdue|late task/.test(normalized)) {
    const items = today.queues.overdueTasks;
    return {
      content: items.length
        ? `You have ${items.length} overdue CRM task${items.length === 1 ? "" : "s"}.\n\n${listLines(items, item => `• ${item.title} — ${dateLabel(item.dueAt)}`)}${items.length > 8 ? `\n\nAnd ${items.length - 8} more.` : ""}`
        : "You have no overdue CRM tasks right now.",
      suggestedAction: { label: "Open today's work", path: "/today" },
    };
  }

  if (/due today|today.*task|tasks? (?:for|due) today/.test(normalized)) {
    const items = today.queues.dueToday;
    return {
      content: items.length
        ? `You have ${items.length} CRM task${items.length === 1 ? "" : "s"} due today.\n\n${listLines(items, item => `• ${item.title} — ${dateLabel(item.dueAt)}`)}${items.length > 8 ? `\n\nAnd ${items.length - 8} more.` : ""}`
        : "You have no CRM tasks due today.",
      suggestedAction: { label: "Open today's work", path: "/today" },
    };
  }

  if (
    /callback|call back|callbacks/.test(normalized) &&
    !/prepare|notes?|coach/.test(normalized)
  ) {
    const items = today.queues.callbacks;
    return {
      content: items.length
        ? `You have ${items.length} callback${items.length === 1 ? "" : "s"} due.\n\n${listLines(items, item => `• ${item.leadLabel}: ${item.title} — ${dateLabel(item.dueAt)}`)}`
        : "You have no callbacks due right now.",
      suggestedAction: { label: "Open today's work", path: "/today" },
    };
  }

  if (/remind|reminder|what.*reminder/.test(normalized)) {
    const items = today.queues.reminders;
    return {
      content: items.length
        ? `You have ${items.length} reminder${items.length === 1 ? "" : "s"} due.\n\n${listLines(items, item => `• ${item.title} — ${dateLabel(item.dueAt)}`)}`
        : "You have no reminders due right now.",
      suggestedAction: { label: "Open today's work", path: "/today" },
    };
  }

  if (
    /who should i (?:contact|call|follow up with) (?:next|first)|what should i do (?:next|first|today)|next best action|who needs attention|prioriti[sz]e my/.test(
      normalized
    )
  ) {
    const items = today.queues.priority;
    return {
      content: items.length
        ? `I'd focus on these first:\n\n${listLines(items, (item, index) => `${index + 1}. ${item.name}${item.stage ? ` — ${item.stage}` : ""}\n   ${item.reasons.join(" · ")}`, 5)}`
        : "There isn't a priority customer queue yet. If your CRM has just been connected, give it a moment to synchronize and I’ll rank the work as soon as records are available.",
      suggestedAction: { label: "Open priorities", path: "/today" },
    };
  }

  if (
    /waiting for us|needs.*reply|waiting for.*reply|unanswered|inbound|repl(?:y|ies)/.test(
      normalized
    )
  ) {
    const items = today.queues.inbound;
    return {
      content: items.length
        ? `There ${items.length === 1 ? "is" : "are"} ${items.length} customer repl${items.length === 1 ? "y" : "ies"} needing attention.\n\n${listLines(items, item => `• ${item.senderReference}${item.subject ? ` — ${item.subject}` : ""}`, 6)}`
        : "There are no customer replies currently marked as needing action.",
      suggestedAction: { label: "Open today's work", path: "/today" },
    };
  }

  return undefined;
}

function directAssistantAction(
  query: string
): PublicAssistantResponse | undefined {
  const normalized = query.toLowerCase();
  if (
    /(?:take|keep|write|capture).*(?:notes?|minutes?)|(?:notes?|summary).*(?:next|this|my).*(?:call|conversation)/.test(
      normalized
    )
  )
    return {
      content:
        "Yes. Open the call companion before the call. I can keep the customer context alongside the conversation, help capture factual notes, identify objections and turn the outcome into clear next steps.",
      suggestedAction: { label: "Open call companion", path: "/calls" },
    };
  if (/open.*crm|show.*crm|go to.*crm/.test(normalized))
    return {
      content: "Your private CRM workspace is ready to open.",
      suggestedAction: { label: "Open CRM", path: "/crm" },
    };
  return undefined;
}

function compactTask(item: {
  title: string;
  dueAt: Date | null;
  status: string;
}) {
  return { title: item.title, dueAt: item.dueAt, status: item.status };
}

function compactPriority(item: {
  id: number;
  name: string;
  pipeline: string | null;
  stage: string | null;
  reasons: string[];
  nextStepAt: Date | null;
}) {
  return {
    id: item.id,
    name: item.name,
    pipeline: item.pipeline,
    stage: item.stage,
    reasons: item.reasons,
    nextStepAt: item.nextStepAt,
  };
}

export function registerAssistantRoutes(app: Express) {
  app.post("/api/assistant", async (req, res: Response) => {
    try {
      const { userId, membership } = await requireLocalHttpContext(req);
      const messages = cleanMessages(req.body?.messages);
      const contactId =
        Number.isInteger(req.body?.contactId) && Number(req.body.contactId) > 0
          ? Number(req.body.contactId)
          : undefined;
      const query = messages
        .filter(message => message.role === "user")
        .map(message => message.content)
        .join("\n")
        .trim();
      if (!query) throw new Error("ASSISTANT_MESSAGE_EMPTY");

      const latestUserMessage =
        [...messages].reverse().find(message => message.role === "user")
          ?.content ?? query;
      const requestedMemory = parseRememberCommand(latestUserMessage);
      if (requestedMemory) {
        if (
          !isSafeAssistantMemory(
            `${requestedMemory.subject}\n${requestedMemory.content}`
          )
        )
          return res.json({
            content:
              "I won't save passwords, verification codes, tokens or other sign-in secrets. Keep those only in the service's secure sign-in page.",
          });
        await createAssistantMemory({
          userId,
          organisationId: membership.organisationId,
          ...requestedMemory,
          provenance: "user_asserted",
          sourceReference: `assistant:${Date.now()}`,
          occurredAt: new Date(),
        });
        return res.json({
          content: `I'll remember that ${requestedMemory.subject} ${requestedMemory.content}.`,
        });
      }

      const today = await getTodayWork({
        userId,
        organisationId: membership.organisationId,
      });

      const direct =
        directAssistantAction(query) || deterministicTodayAnswer(query, today);
      if (direct) {
        await recordAudit({
          userId,
          organisationId: membership.organisationId,
          eventType: "assistant_request_routed",
          entityType: "assistant",
          entityId: String(userId),
          summary:
            "The Sales Assistant answered from current workspace context.",
          metadata: { responseMode: "workspace_truth", contentRetained: false },
        });
        return res.json(direct);
      }

      const batchAction = planAssistantCrmBatchInstruction(query);
      if (batchAction) {
        const systems = await listConnectedSystemsForUser(
          userId,
          membership.organisationId
        );
        const routed = routeConnectedSystemActions([batchAction], systems);
        const workflowRunId = await createWorkflowRun({
          userId,
          organisationId: membership.organisationId,
          workflowKey: "assistant_deterministic_batch",
          leadLabel: batchAction.targetLabel,
          payload: { instruction: query, plannerCalls: 1 },
          verificationSummary:
            "Prepared from a structured assistant instruction. External changes remain review-controlled.",
          actions: routed,
        });
        const routable = Boolean(
          (routed[0]?.payload.crmRoute as { routable?: boolean } | undefined)
            ?.routable
        );
        return res.json(
          routable
            ? {
                content:
                  "I prepared that CRM change for review. Nothing has been changed yet. Check the proposed action, then approve it when you're happy.",
                suggestedAction: {
                  label: "Review proposed change",
                  path: "/reviews",
                },
                reviewRequired: true,
              }
            : {
                content:
                  "I understand the change you want, but that CRM action isn't available on the current connection yet. I haven't changed anything.",
              }
        );
      }

      const route = routeSalesCommand(query);
      const contactContext = contactId
        ? await getWorkingContextForContact({
            organisationId: membership.organisationId,
            contactId,
          })
        : undefined;
      const [sources, operationalContext, relevantMemory, user] =
        await Promise.all([
          searchApprovedKnowledge(userId, membership.organisationId, query),
          getAssistantOperationalContext(userId, membership.organisationId),
          listRelevantAssistantMemories({
            userId,
            organisationId: membership.organisationId,
            query,
            contactExternalId: contactContext?.contactExternalId,
          }),
          getUserById(userId),
        ]);
      const approvedKnowledge = sources.length
        ? sources
            .map(
              source =>
                `[${source.title}]\n${source.content ?? source.sourceUrl ?? "No retained body."}`
            )
            .join("\n\n---\n\n")
        : undefined;
      const workingContext = JSON.stringify({
        user: {
          firstName:
            membership.memberOnboarding.preferredName ||
            user?.name?.trim().split(/\s+/)[0] ||
            null,
          role: membership.role,
          personalSalesGoal: membership.memberOnboarding.primaryGoal || null,
          workingStyle: membership.memberOnboarding.workingStyle || null,
        },
        selectedCustomer: contactContext ?? null,
        relevantMemory: relevantMemory.map(memory => ({
          type: memory.memoryType,
          subject: memory.subject,
          content: memory.content,
          trust: memory.trust,
          occurredAt: memory.occurredAt ?? memory.createdAt,
          contactExternalId: memory.contactExternalId,
        })),
        today: {
          generatedAt: today.generatedAt,
          metrics: today.metrics,
          priority: today.queues.priority.slice(0, 8).map(compactPriority),
          overdueTasks: today.queues.overdueTasks.slice(0, 12).map(compactTask),
          dueToday: today.queues.dueToday.slice(0, 12).map(compactTask),
          callbacks: today.queues.callbacks.slice(0, 10).map(item => ({
            title: item.title,
            leadLabel: item.leadLabel,
            dueAt: item.dueAt,
          })),
          reminders: today.queues.reminders.slice(0, 10).map(item => ({
            title: item.title,
            dueAt: item.dueAt,
          })),
          inbound: today.queues.inbound.slice(0, 10).map(item => ({
            senderReference: item.senderReference,
            subject: item.subject,
            channel: item.channel,
            receivedAt: item.receivedAt,
          })),
        },
        recentCalls: operationalContext.recentCalls,
        approvedPlaybooks: operationalContext.approvedPlaybooks,
        allowedActions: operationalContext.allowedActions,
        connections: operationalContext.connections,
        requestRoute: route.summary,
      });

      const response = await runGenxAgent({
        agentKey: route.agentKey,
        messages,
        approvedKnowledge,
        workingContext,
      });
      await recordAudit({
        userId,
        organisationId: membership.organisationId,
        eventType: "assistant_response_generated",
        entityType: "assistant",
        entityId: String(userId),
        summary: "The Sales Assistant generated a context-aware response.",
        metadata: {
          route: route.intent,
          specialist: route.agentKey,
          memoryCount: relevantMemory.length,
          contentRetained: false,
        },
      });
      const result: PublicAssistantResponse = {
        content: response.content,
        ...(route.suggestedPath && route.suggestedLabel
          ? {
              suggestedAction: {
                label: route.suggestedLabel,
                path: route.suggestedPath,
              },
            }
          : {}),
      };
      return res.json(result);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const status = /AUTH_REQUIRED/.test(detail)
        ? 401
        : /TWO_FACTOR_REQUIRED/.test(detail)
          ? 403
          : 400;
      console.error(
        JSON.stringify({
          event: "assistant_request_failed",
          detail: detail.slice(0, 300),
        })
      );
      return res.status(status).json({ error: customerMessage(error) });
    }
  });
}
