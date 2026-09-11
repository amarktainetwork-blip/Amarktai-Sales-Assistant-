import { describe, expect, it, vi } from "vitest";
import {
  assistantReminders,
  callbackTasks,
  crmContacts,
  crmOpportunities,
  crmTasks,
  externalUserMappings,
  inboundMessages,
} from "../drizzle/schema";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  requireOrganisationMembership: vi.fn(),
}));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./organisation", () => ({
  requireOrganisationMembership: mocks.requireOrganisationMembership,
  canViewTeamData: () => false,
}));
vi.mock("./clientActionConfiguration", () => ({
  getClientActionConfiguration: vi.fn(async () => ({
    workflows: {},
    templates: {},
    approvedSenders: { sms: [], whatsapp: [] },
    duplicateRules: [],
    closureMapping: {},
    requiredPostconditions: {},
    currentRecordRules: [],
    paymentReview: { enabled: true, pendingStages: ["Awaiting settlement"] },
  })),
}));

import { getTodayWork } from "./today";

describe("Today inbound ownership lookup", () => {
  it("does not reuse a CRM owner ID across different connected systems", async () => {
    const rows = new Map<unknown, unknown[]>([
      [
        externalUserMappings,
        [
          {
            externalUserId: "shared-id",
            connectedSystemId: 11,
            userId: 9,
            isActive: true,
          },
        ],
      ],
      [
        crmTasks,
        [11, 12].map(connectedSystemId => ({
          id: connectedSystemId,
          connectedSystemId,
          externalId: "task",
          ownerExternalId: "shared-id",
          title: "Follow up",
          status: "open",
          dueAt: new Date(Date.now() - 60000),
        })),
      ],
      [
        crmOpportunities,
        [
          {
            id: 1,
            connectedSystemId: 11,
            externalId: "own",
            ownerExternalId: "shared-id",
            name: "Own opportunity",
            stage: "Awaiting settlement",
          },
          {
            id: 2,
            connectedSystemId: 12,
            externalId: "other-system",
            ownerExternalId: "shared-id",
            name: "Other connection",
            stage: "Awaiting settlement",
          },
          {
            id: 3,
            connectedSystemId: 11,
            externalId: "unknown",
            ownerExternalId: null,
            name: "Unknown owner",
            stage: "Awaiting settlement",
          },
          {
            id: 4,
            connectedSystemId: 11,
            externalId: "other-owner",
            ownerExternalId: "other",
            name: "Other owner",
            stage: "Awaiting settlement",
          },
        ],
      ],
      [inboundMessages, []],
      [assistantReminders, []],
      [callbackTasks, []],
    ]);
    mocks.getDb.mockResolvedValue({
      select: () => ({
        from: (table: unknown) => {
          const result = rows.get(table) || [];
          const chain = {
            where: () => chain,
            orderBy: () => chain,
            leftJoin: () => chain,
            limit: async () => result,
            then: (resolve: any) => Promise.resolve(result).then(resolve),
          };
          return chain;
        },
      }),
    });
    mocks.requireOrganisationMembership.mockResolvedValue({
      role: "salesperson",
    });
    const result = await getTodayWork({ userId: 9, organisationId: 4 });
    expect(result.metrics.overdue).toBe(1);
    expect(result.paymentReview.status).toBe("manual_source_check_required");
    expect(
      result.paymentReview.candidates.map(item => item.externalId)
    ).toEqual(["own"]);
  });
  it("uses the exact joined contact identity instead of a 2,000-contact slice", async () => {
    const fromCalls: unknown[] = [];
    const rows = new Map<unknown, unknown[]>([
      [
        externalUserMappings,
        [
          {
            externalUserId: "owner-2001",
            connectedSystemId: 11,
            userId: 9,
            isActive: true,
          },
        ],
      ],
      [crmTasks, []],
      [crmOpportunities, []],
      [assistantReminders, []],
      [callbackTasks, []],
      [
        inboundMessages,
        [
          {
            message: {
              id: 55,
              connectedSystemId: 11,
              contactExternalId: "contact-2001",
              senderReference: "late@example.test",
              subject: "Please call",
              channel: "email",
              classification: {},
              receivedAt: new Date(),
              needsAction: true,
            },
            contactOwnerExternalId: "owner-2001",
          },
        ],
      ],
    ]);
    const database = {
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => {
          fromCalls.push(table);
          const result = rows.get(table) || [];
          const chain = {
            where: vi.fn(() => chain),
            orderBy: vi.fn(() => chain),
            leftJoin: vi.fn(() => chain),
            limit: vi.fn(async (count: number) => result.slice(0, count)),
            then: (
              resolve: (value: unknown[]) => unknown,
              reject: (error: unknown) => unknown
            ) => Promise.resolve(result).then(resolve, reject),
          };
          return chain;
        }),
      })),
    };
    mocks.getDb.mockResolvedValue(database);
    mocks.requireOrganisationMembership.mockResolvedValue({
      role: "salesperson",
    });
    const result = await getTodayWork({ userId: 9, organisationId: 4 });
    expect(result.metrics.inboundNeedsAction).toBe(1);
    expect(result.queues.inbound[0]).toMatchObject({
      id: 55,
      contactExternalId: "contact-2001",
    });
    expect(fromCalls.filter(table => table === crmContacts)).toHaveLength(0);
  });

  it("includes a due Amarktai reminder in the normal Today queue", async () => {
    const reminder = {
      id: 77,
      organisationId: 4,
      userId: 9,
      title: "Call Sarah",
      dueAt: new Date(),
      status: "open",
    };
    const rows = new Map<unknown, unknown[]>([
      [externalUserMappings, []],
      [crmTasks, []],
      [crmOpportunities, []],
      [inboundMessages, []],
      [assistantReminders, [reminder]],
      [callbackTasks, []],
    ]);
    const database = {
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => {
          const result = rows.get(table) || [];
          const chain = {
            where: vi.fn(() => chain),
            orderBy: vi.fn(() => chain),
            leftJoin: vi.fn(() => chain),
            limit: vi.fn(async (count: number) => result.slice(0, count)),
            then: (
              resolve: (value: unknown[]) => unknown,
              reject: (error: unknown) => unknown
            ) => Promise.resolve(result).then(resolve, reject),
          };
          return chain;
        }),
      })),
    };
    mocks.getDb.mockResolvedValue(database);
    mocks.requireOrganisationMembership.mockResolvedValue({
      role: "salesperson",
    });

    const result = await getTodayWork({ userId: 9, organisationId: 4 });

    expect(result.metrics.remindersDue).toBe(1);
    expect(result.queues.reminders).toEqual([reminder]);
    expect(result.metrics.dueToday).toBe(1);
  });
});
