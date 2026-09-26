import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  externalUserMappings,
  salesActivityEvents,
} from "../../drizzle/schema";
import { getDb } from "../db";
import type {
  NormalizedContact,
  NormalizedOpportunity,
  NormalizedTask,
} from "./types";
import { isCompletedTask } from "../../shared/taskState";

export type CrmChangeEvent = {
  eventType: string;
  resourceType: "contact" | "opportunity" | "task";
  resourceExternalId: string;
  externalOwnerId?: string;
  contactExternalId?: string;
  opportunityExternalId?: string;
  occurredAt: Date;
  metadata: Record<string, unknown>;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}
function iso(value?: Date | null) {
  return value?.toISOString() || "";
}
function rawStatus(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return text((value as Record<string, unknown>).status).toLowerCase();
}
function event(
  base: Omit<CrmChangeEvent, "eventType" | "metadata">,
  eventType: string,
  metadata: Record<string, unknown>
): CrmChangeEvent {
  return { ...base, eventType, metadata };
}

export function deriveContactChangeEvents(input: {
  previous?: Pick<
    typeof import("../../drizzle/schema").crmContacts.$inferSelect,
    "externalId" | "ownerExternalId" | "lifecycleStage" | "sourceUpdatedAt"
  >;
  current: NormalizedContact;
  baselineComplete?: boolean;
}) {
  const current = input.current;
  const base = {
    resourceType: "contact" as const,
    resourceExternalId: current.externalId,
    externalOwnerId: current.ownerExternalId,
    contactExternalId: current.externalId,
    occurredAt: current.sourceUpdatedAt || new Date(),
  };
  if (!input.previous) {
    return input.baselineComplete
      ? [
          event(base, "new_lead", {
            currentOwnerExternalId: current.ownerExternalId || null,
            lifecycleStage: current.lifecycleStage || null,
          }),
        ]
      : [];
  }
  const output: CrmChangeEvent[] = [];
  if (
    text(input.previous.ownerExternalId) !== text(current.ownerExternalId) &&
    text(current.ownerExternalId)
  )
    output.push(
      event(base, "customer_owner_changed", {
        previousOwnerExternalId: input.previous.ownerExternalId || null,
        currentOwnerExternalId: current.ownerExternalId || null,
      })
    );
  if (
    text(input.previous.lifecycleStage) !== text(current.lifecycleStage) &&
    (text(input.previous.lifecycleStage) || text(current.lifecycleStage))
  )
    output.push(
      event(base, "customer_state_changed", {
        previousLifecycleStage: input.previous.lifecycleStage || null,
        currentLifecycleStage: current.lifecycleStage || null,
      })
    );
  return output;
}

export function deriveOpportunityChangeEvents(input: {
  previous?: Pick<
    typeof import("../../drizzle/schema").crmOpportunities.$inferSelect,
    | "externalId"
    | "contactExternalId"
    | "ownerExternalId"
    | "stage"
    | "closeAt"
    | "nextStepAt"
    | "sourceUpdatedAt"
    | "raw"
  >;
  current: NormalizedOpportunity;
  baselineComplete?: boolean;
}) {
  const current = input.current;
  const previous = input.previous;
  if (!previous) {
    if (!input.baselineComplete) return [];
    const base = {
      resourceType: "opportunity" as const,
      resourceExternalId: current.externalId,
      externalOwnerId: current.ownerExternalId,
      contactExternalId: current.contactExternalId,
      opportunityExternalId: current.externalId,
      occurredAt: current.sourceUpdatedAt || current.closeAt || new Date(),
    };
    const currentStatus = rawStatus(current.raw);
    const output = [
      event(base, "opportunity_created", {
        currentStage: current.stage || null,
        currentStatus: currentStatus || null,
      }),
    ];
    if (currentStatus === "won")
      output.push(
        event(
          { ...base, occurredAt: current.closeAt || base.occurredAt },
          "sale_won",
          {
            previousStatus: null,
            currentStatus: "won",
            previousStage: null,
            currentStage: current.stage || null,
            closeAt: iso(current.closeAt),
            source: "new_opportunity_after_baseline",
          }
        )
      );
    return output;
  }
  const base = {
    resourceType: "opportunity" as const,
    resourceExternalId: current.externalId,
    externalOwnerId: current.ownerExternalId,
    contactExternalId: current.contactExternalId,
    opportunityExternalId: current.externalId,
    occurredAt: current.sourceUpdatedAt || current.closeAt || new Date(),
  };
  const output: CrmChangeEvent[] = [];
  const previousStatus = rawStatus(previous.raw);
  const currentStatus = rawStatus(current.raw);
  if (previousStatus !== "won" && currentStatus === "won")
    output.push(
      event(
        { ...base, occurredAt: current.closeAt || base.occurredAt },
        "sale_won",
        {
          previousStatus: previousStatus || null,
          currentStatus: "won",
          previousStage: previous.stage || null,
          currentStage: current.stage || null,
          closeAt: iso(current.closeAt),
        }
      )
    );
  if (text(previous.stage) !== text(current.stage))
    output.push(
      event(base, "opportunity_stage_changed", {
        previousStage: previous.stage || null,
        currentStage: current.stage || null,
        previousStatus: previousStatus || null,
        currentStatus: currentStatus || null,
      })
    );
  if (
    text(previous.ownerExternalId) !== text(current.ownerExternalId) &&
    text(current.ownerExternalId)
  )
    output.push(
      event(base, "opportunity_owner_changed", {
        previousOwnerExternalId: previous.ownerExternalId || null,
        currentOwnerExternalId: current.ownerExternalId || null,
      })
    );
  if (iso(previous.nextStepAt) !== iso(current.nextStepAt))
    output.push(
      event(base, "opportunity_next_step_changed", {
        previousNextStepAt: iso(previous.nextStepAt) || null,
        currentNextStepAt: iso(current.nextStepAt) || null,
      })
    );
  return output;
}

export function deriveTaskChangeEvents(input: {
  previous?: Pick<
    typeof import("../../drizzle/schema").crmTasks.$inferSelect,
    | "externalId"
    | "contactExternalId"
    | "opportunityExternalId"
    | "ownerExternalId"
    | "title"
    | "status"
    | "dueAt"
    | "sourceUpdatedAt"
  >;
  current: NormalizedTask;
  baselineComplete?: boolean;
}) {
  const current = input.current;
  const base = {
    resourceType: "task" as const,
    resourceExternalId: current.externalId,
    externalOwnerId: current.ownerExternalId,
    contactExternalId: current.contactExternalId,
    opportunityExternalId: current.opportunityExternalId,
    occurredAt: current.sourceUpdatedAt || current.completedAt || new Date(),
  };
  if (!input.previous) {
    return input.baselineComplete && text(current.ownerExternalId)
      ? [
          event(base, "task_assigned", {
            title: current.title,
            currentOwnerExternalId: current.ownerExternalId || null,
            dueAt: iso(current.dueAt) || null,
            source: "new_task_after_baseline",
          }),
        ]
      : [];
  }
  const previous = input.previous;
  const output: CrmChangeEvent[] = [];
  if (
    text(previous.ownerExternalId) !== text(current.ownerExternalId) &&
    text(current.ownerExternalId)
  )
    output.push(
      event(base, "task_assigned", {
        title: current.title,
        previousOwnerExternalId: previous.ownerExternalId || null,
        currentOwnerExternalId: current.ownerExternalId || null,
      })
    );
  if (!isCompletedTask(previous.status) && isCompletedTask(current.status))
    output.push(
      event(base, "task_completed_in_crm", {
        title: current.title,
        previousStatus: previous.status,
        currentStatus: current.status,
      })
    );
  if (iso(previous.dueAt) !== iso(current.dueAt))
    output.push(
      event(base, "task_rescheduled", {
        title: current.title,
        previousDueAt: iso(previous.dueAt) || null,
        currentDueAt: iso(current.dueAt) || null,
      })
    );
  return output;
}

function eventExternalId(change: CrmChangeEvent) {
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        resourceType: change.resourceType,
        resourceExternalId: change.resourceExternalId,
        eventType: change.eventType,
        occurredAt: change.occurredAt.toISOString(),
        metadata: change.metadata,
      })
    )
    .digest("hex")
    .slice(0, 32);
  return `change:${change.resourceType}:${fingerprint}`;
}

export async function persistCrmChangeEvents(input: {
  organisationId: number;
  connectedSystemId: number;
  changes: CrmChangeEvent[];
}) {
  if (!input.changes.length) return 0;
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  let inserted = 0;
  for (const change of input.changes) {
    const owner = change.externalOwnerId
      ? (
          await db
            .select({ userId: externalUserMappings.userId })
            .from(externalUserMappings)
            .where(
              and(
                eq(externalUserMappings.organisationId, input.organisationId),
                eq(
                  externalUserMappings.connectedSystemId,
                  input.connectedSystemId
                ),
                eq(
                  externalUserMappings.externalUserId,
                  change.externalOwnerId
                ),
                eq(externalUserMappings.isActive, true)
              )
            )
            .limit(1)
        )[0]
      : undefined;
    const result = await db
      .insert(salesActivityEvents)
      .values({
        organisationId: input.organisationId,
        connectedSystemId: input.connectedSystemId,
        salespersonUserId: owner?.userId ?? null,
        externalOwnerId: change.externalOwnerId ?? null,
        contactExternalId: change.contactExternalId ?? null,
        opportunityExternalId: change.opportunityExternalId ?? null,
        eventType: change.eventType,
        source: "crm_change",
        occurredAt: change.occurredAt,
        externalId: eventExternalId(change),
        metadata: {
          ...change.metadata,
          resourceType: change.resourceType,
          resourceExternalId: change.resourceExternalId,
        },
      })
      .onDuplicateKeyUpdate({
        set: {
          occurredAt: change.occurredAt,
          metadata: {
            ...change.metadata,
            resourceType: change.resourceType,
            resourceExternalId: change.resourceExternalId,
          },
        },
      });
    inserted += Number(result[0].affectedRows || 0) > 0 ? 1 : 0;
  }
  return inserted;
}
