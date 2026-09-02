import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  evaluateStructuredBatchRecord,
  executeAssistantCrmBatch,
  parseMappedStageInstruction,
  planAssistantCrmBatchInstruction,
  validateAssistantCrmBatchPlan,
} from "./assistantBatchExecution";
import type {
  CrmAdapter,
  NormalizedContact,
  NormalizedOpportunity,
  NormalizedTask,
} from "./types";

const connection = {
  id: 91,
  organisationId: 17,
  provider: "genie" as const,
  displayName: "Genie",
  baseUrl: "https://genie.example.test",
  connectionMethod: "browser" as const,
  allowedReadCapabilities: ["contacts.read", "tasks.read"],
  allowedWriteCapabilities: ["tasks.write"],
  verifiedCapabilities: ["contacts.read", "tasks.read", "tasks.write"],
  scopes: [],
  configuration: {},
};

function fixtureAdapter(
  records: NormalizedContact[],
  options?: { permanentFailure?: string }
) {
  const tasks: NormalizedTask[] = [];
  let active = 0;
  let maximumActive = 0;
  let writes = 0;
  let readbacks = 0;
  const adapter = {
    syncContacts: vi.fn(async ({ cursor }: { cursor?: string }) => {
      const start = cursor ? Number(cursor) : 0;
      const page = records.slice(start, start + 125);
      const next = start + page.length;
      return {
        records: page,
        cursor: next < records.length ? String(next) : undefined,
      };
    }),
    createTask: vi.fn(
      async ({ contactExternalId, title }: { contactExternalId?: string; title: string }) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        writes += 1;
        await Promise.resolve();
        active -= 1;
        if (contactExternalId === options?.permanentFailure)
          throw new Error("provider rate limit remained exhausted");
        tasks.push({
          externalId: `task-${contactExternalId}`,
          contactExternalId,
          title,
          status: "open",
          raw: {},
        });
        return {
          operation: "create_task",
          completedAt: new Date().toISOString(),
          correlationId: "test",
        };
      }
    ),
    syncTasks: vi.fn(async () => {
      readbacks += 1;
      return { records: tasks };
    }),
  } as unknown as CrmAdapter;
  return {
    adapter,
    metrics: () => ({ maximumActive, writes, readbacks }),
  };
}

describe("real assistant deterministic CRM batch path", () => {
  it("plans the governed proposal from the existing natural-language assistant path", () => {
    const proposal = planAssistantCrmBatchInstruction(
      "Make sure all 1,000 overdue leads have a next action."
    );
    expect(proposal).toMatchObject({
      actionType: "deterministic_crm_batch",
      payload: {
        reviewRequired: true,
        batchPlan: {
          actionType: "schedule_callback",
          operationKey: "task.create_callback",
        },
      },
    });
    expect(validateAssistantCrmBatchPlan(proposal!.payload.batchPlan)).toMatchObject({
      source: "contacts",
      structuredPredicate: "overdue_without_next_action",
    });
  });

  it("never hard-codes a client stage name and requires the requested source status and target stage", () => {
    expect(
      parseMappedStageInstruction(
        "Move every opportunity with status Qualified into stage Consultation Booked."
      )
    ).toEqual({
      sourceStatus: "Qualified",
      targetStage: "Consultation Booked",
    });

    const proposal = planAssistantCrmBatchInstruction(
      "Move every opportunity with status Qualified into stage Consultation Booked."
    );
    expect(proposal?.payload.batchPlan).toMatchObject({
      structuredPredicate: "mapped_status_wrong_stage",
      sourceStatus: "Qualified",
      targetStage: "Consultation Booked",
      patch: { stage: "Consultation Booked" },
    });

    expect(
      planAssistantCrmBatchInstruction(
        "Make sure every accepted opportunity is in the right stage."
      )
    ).toBeUndefined();

    const plan = validateAssistantCrmBatchPlan(proposal!.payload.batchPlan);
    const wrongStage = {
      externalId: "opp-1",
      name: "Example",
      stage: "Lead",
      raw: { status: "Qualified" },
    } satisfies NormalizedOpportunity;
    const correctStage = {
      ...wrongStage,
      externalId: "opp-2",
      stage: "Consultation Booked",
    } satisfies NormalizedOpportunity;
    const wrongStatus = {
      ...wrongStage,
      externalId: "opp-3",
      raw: { status: "Lost" },
    } satisfies NormalizedOpportunity;
    expect(evaluateStructuredBatchRecord(wrongStage, plan)).toBe(true);
    expect(evaluateStructuredBatchRecord(correctStage, plan)).toBe(false);
    expect(evaluateStructuredBatchRecord(wrongStatus, plan)).toBe(false);
  });

  it("processes 1,000 structured records through the production assistant wrapper with bounded AI and concurrency", async () => {
    const records = Array.from({ length: 1_000 }, (_, index) => ({
      externalId: `lead-${index + 1}`,
      firstName: "Overdue",
      lastName: String(index + 1),
      raw: { overdue: true },
    } satisfies NormalizedContact));
    const fixture = fixtureAdapter(records);
    const completed = new Set<string>();
    const ambiguity = vi.fn(async () => true);
    const proposal = planAssistantCrmBatchInstruction(
      "Make sure all 1,000 overdue leads have a next action."
    )!;
    const plan = validateAssistantCrmBatchPlan(proposal.payload.batchPlan);
    const result = await executeAssistantCrmBatch({
      organisationId: 17,
      proposalId: 501,
      correlationId: "assistant-batch-first",
      instruction: String(proposal.payload.instruction),
      plan,
      connection,
      adapter: fixture.adapter,
      secret: {},
      resolveAmbiguous: ambiguity,
      alreadyCompleted: async key => completed.has(key),
      markCompleted: async key => void completed.add(key),
      pageSize: 125,
      concurrency: 8,
      maxRetries: 2,
    });
    expect(result.success).toBe(true);
    expect(result.providerResult).toMatchObject({
      progress: {
        discovered: 1_000,
        completed: 1_000,
        skipped: 0,
        failed: 0,
      },
      aiCalls: { planning: 0, ambiguity: 0 },
      crmOperations: 1_000,
      deterministicReadbacks: 1_000,
    });
    expect(ambiguity).not.toHaveBeenCalled();
    expect(fixture.metrics()).toMatchObject({
      maximumActive: 8,
      writes: 1_000,
      readbacks: 1_000,
    });

    const retry = await executeAssistantCrmBatch({
      organisationId: 17,
      proposalId: 501,
      correlationId: "assistant-batch-retry",
      instruction: String(proposal.payload.instruction),
      plan,
      connection,
      adapter: fixture.adapter,
      secret: {},
      alreadyCompleted: async key => completed.has(key),
      markCompleted: async key => void completed.add(key),
      pageSize: 125,
      concurrency: 8,
    });
    expect(retry.providerResult).toMatchObject({
      progress: {
        discovered: 1_000,
        completed: 0,
        skipped: 1_000,
        failed: 0,
      },
      crmOperations: 0,
      deterministicReadbacks: 0,
    });
  });

  it("surfaces a bounded permanent partial failure in the one final assistant result", async () => {
    const records = Array.from({ length: 10 }, (_, index) => ({
      externalId: `lead-${index + 1}`,
      raw: { overdue: true },
    } satisfies NormalizedContact));
    const fixture = fixtureAdapter(records, { permanentFailure: "lead-10" });
    const proposal = planAssistantCrmBatchInstruction(
      "Make sure all overdue leads have a next action."
    )!;
    const result = await executeAssistantCrmBatch({
      organisationId: 17,
      proposalId: 502,
      correlationId: "assistant-batch-partial",
      instruction: String(proposal.payload.instruction),
      plan: validateAssistantCrmBatchPlan(proposal.payload.batchPlan),
      connection,
      adapter: fixture.adapter,
      secret: {},
      concurrency: 4,
      maxRetries: 2,
    });
    expect(result.success).toBe(false);
    expect(result.detail).toContain("1 failed");
    expect(result.providerResult).toMatchObject({
      progress: { discovered: 10, completed: 9, failed: 1 },
    });
  });

  it("invokes AI only for the genuinely ambiguous subset", async () => {
    const records = Array.from({ length: 20 }, (_, index) => ({
      externalId: `lead-${index + 1}`,
      raw: index < 3 ? {} : { overdue: true },
    } satisfies NormalizedContact));
    const fixture = fixtureAdapter(records);
    const ambiguity = vi.fn(async () => true);
    const proposal = planAssistantCrmBatchInstruction(
      "Make sure all overdue leads have a next action."
    )!;
    const result = await executeAssistantCrmBatch({
      organisationId: 17,
      proposalId: 503,
      correlationId: "assistant-batch-ambiguous",
      instruction: String(proposal.payload.instruction),
      plan: validateAssistantCrmBatchPlan(proposal.payload.batchPlan),
      connection,
      adapter: fixture.adapter,
      secret: {},
      resolveAmbiguous: ambiguity,
      concurrency: 5,
    });
    expect(ambiguity).toHaveBeenCalledTimes(3);
    expect(result.providerResult).toMatchObject({
      progress: { discovered: 20, completed: 20, failed: 0 },
      aiCalls: { planning: 0, ambiguity: 3 },
      crmOperations: 20,
      deterministicReadbacks: 20,
    });
  });

  it("is called by the existing assistant proposal and execution runtime", () => {
    const routers = readFileSync(new URL("../routers.ts", import.meta.url), "utf8");
    const execution = readFileSync(
      new URL("./executeApprovedAction.ts", import.meta.url),
      "utf8"
    );
    expect(routers).toContain("planAssistantCrmBatchInstruction(query)");
    expect(routers).toContain("createWorkflowRun");
    expect(execution).toContain("executeAssistantCrmBatch");
    expect(execution).toContain("payload.reviewRequired !== true");
  });
});
