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

import { getTodayWork } from "./today";

describe("Today inbound ownership lookup", () => {
  it("uses the exact joined contact identity instead of a 2,000-contact slice", async () => {
    const fromCalls: unknown[] = [];
    const rows = new Map<unknown, unknown[]>([
      [externalUserMappings, [{ externalUserId: "owner-2001", userId: 9, isActive: true }]],
      [crmTasks, []],
      [crmOpportunities, []],
      [assistantReminders, []],
      [callbackTasks, []],
      [inboundMessages, [{ message: { id: 55, contactExternalId: "contact-2001", senderReference: "late@example.test", subject: "Please call", channel: "email", classification: {}, receivedAt: new Date(), needsAction: true }, contactOwnerExternalId: "owner-2001" }]],
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
            then: (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
          };
          return chain;
        }),
      })),
    };
    mocks.getDb.mockResolvedValue(database);
    mocks.requireOrganisationMembership.mockResolvedValue({ role: "salesperson" });
    const result = await getTodayWork({ userId: 9, organisationId: 4 });
    expect(result.metrics.inboundNeedsAction).toBe(1);
    expect(result.queues.inbound[0]).toMatchObject({ id: 55, contactExternalId: "contact-2001" });
    expect(fromCalls.filter(table => table === crmContacts)).toHaveLength(0);
  });

  it("includes a due Amarktai reminder in the normal Today queue", async () => {
    const reminder = { id: 77, organisationId: 4, userId: 9, title: "Call Sarah", dueAt: new Date(), status: "open" };
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
            then: (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
          };
          return chain;
        }),
      })),
    };
    mocks.getDb.mockResolvedValue(database);
    mocks.requireOrganisationMembership.mockResolvedValue({ role: "salesperson" });

    const result = await getTodayWork({ userId: 9, organisationId: 4 });

    expect(result.metrics.remindersDue).toBe(1);
    expect(result.queues.reminders).toEqual([reminder]);
    expect(result.metrics.dueToday).toBe(1);
  });
});
