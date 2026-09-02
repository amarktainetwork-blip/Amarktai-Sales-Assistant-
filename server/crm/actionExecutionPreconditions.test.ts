import { describe, expect, it, vi } from "vitest";
import type { ActionProposal } from "../../drizzle/schema";
import {
  checkApprovedCrmExecutionPreconditions,
  opportunityIsHistorical,
  taskIsHistorical,
} from "./actionExecutionPreconditions";
import type { AdapterConnection, CrmAdapter } from "./types";

const connection = {
  id: 9,
  organisationId: 3,
  provider: "genie",
  displayName: "Genie",
  baseUrl: "https://crm.example.test",
  connectionMethod: "browser",
  allowedReadCapabilities: [
    "contacts.read",
    "tasks.read",
    "opportunities.read",
    "activities.read",
  ],
  allowedWriteCapabilities: ["tasks.write", "opportunities.write"],
  verifiedCapabilities: [
    "contacts.read",
    "tasks.read",
    "opportunities.read",
    "activities.read",
    "tasks.write",
    "opportunities.write",
  ],
  scopes: [],
  configuration: {},
} satisfies AdapterConnection;

function proposal(actionType: string, payload: Record<string, unknown>) {
  return {
    id: 41,
    userId: 7,
    organisationId: 3,
    workflowRunId: 12,
    actionType,
    title: "Reviewed action",
    targetLabel: "Exact Customer",
    idempotencyKey: `test:${actionType}`,
    state: "approved",
    payload,
  } as ActionProposal;
}

function baseAdapter(overrides: Partial<CrmAdapter> = {}) {
  return {
    getContact: vi.fn(async ({ externalId }: { externalId: string }) => ({
      externalId,
      firstName: "Exact",
      lastName: "Customer",
      lifecycleStage: "Active",
      raw: { status: "Active" },
    })),
    syncTasks: vi.fn(async () => ({ records: [] })),
    getOpportunity: vi.fn(async ({ externalId }: { externalId: string }) => ({
      externalId,
      contactExternalId: "contact-1",
      name: "Current opportunity",
      stage: "Open",
      raw: { status: "open" },
    })),
    syncActivities: vi.fn(async () => ({ records: [] })),
    ...overrides,
  } as unknown as CrmAdapter;
}

describe("approved CRM execution preconditions", () => {
  it("classifies completed tasks and closed opportunities as historical", () => {
    expect(taskIsHistorical({ status: "completed", completedAt: undefined })).toBe(
      true
    );
    expect(taskIsHistorical({ status: "open", completedAt: undefined })).toBe(
      false
    );
    expect(opportunityIsHistorical({ stage: "Closed Lost", raw: {} })).toBe(true);
    expect(
      opportunityIsHistorical({ stage: "Discovery", raw: { status: "open" } })
    ).toBe(false);
  });

  it("skips an equivalent existing callback instead of creating a duplicate", async () => {
    const dueAt = "2026-09-03T08:00:00.000Z";
    const adapter = baseAdapter({
      syncTasks: vi.fn(async () => ({
        records: [
          {
            externalId: "task-existing",
            contactExternalId: "contact-1",
            title: "Next follow-up",
            status: "open",
            dueAt: new Date(dueAt),
            raw: {},
          },
        ],
      })),
    });
    const result = await checkApprovedCrmExecutionPreconditions({
      actionType: "schedule_callback",
      adapter,
      connection,
      secret: { browserSession: {} },
      proposal: proposal("schedule_callback", {
        contactExternalId: "contact-1",
        taskTitle: "Next follow-up",
        dueAt,
        workflowConfiguration: {},
      }),
      payload: {
        contactExternalId: "contact-1",
        taskTitle: "Next follow-up",
        dueAt,
        workflowConfiguration: {},
      },
    });
    expect(result).toMatchObject({
      alreadySatisfied: true,
      evidence: { taskExternalId: "task-existing" },
    });
  });

  it("blocks a reviewed opportunity mutation if the exact record became historical", async () => {
    const adapter = baseAdapter({
      getOpportunity: vi.fn(async () => ({
        externalId: "opp-1",
        contactExternalId: "contact-1",
        name: "Historical opportunity",
        stage: "Closed Lost",
        raw: { status: "closed" },
      })),
    });

    await expect(
      checkApprovedCrmExecutionPreconditions({
        actionType: "update_current_opportunity",
        adapter,
        connection,
        secret: { browserSession: {} },
        proposal: proposal("update_current_opportunity", {
          contactExternalId: "contact-1",
          opportunityExternalId: "opp-1",
          patch: { stage: "Another stage" },
          workflowConfiguration: {},
        }),
        payload: {
          contactExternalId: "contact-1",
          opportunityExternalId: "opp-1",
          patch: { stage: "Another stage" },
          workflowConfiguration: {},
        },
      })
    ).rejects.toThrow("HISTORICAL_OPPORTUNITY_PROTECTED");
  });

  it("fails closed if the current exact customer can no longer be read", async () => {
    const adapter = baseAdapter({
      getContact: vi.fn(async () => null),
    });
    await expect(
      checkApprovedCrmExecutionPreconditions({
        actionType: "schedule_callback",
        adapter,
        connection,
        secret: { browserSession: {} },
        proposal: proposal("schedule_callback", {
          contactExternalId: "contact-1",
          taskTitle: "Next follow-up",
          workflowConfiguration: {},
        }),
        payload: {
          contactExternalId: "contact-1",
          taskTitle: "Next follow-up",
          workflowConfiguration: {},
        },
      })
    ).rejects.toThrow("EXECUTION_TARGET_STALE");
  });
});
