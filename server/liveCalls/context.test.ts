import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectedSystems,
  crmActivities,
  crmCompanies,
  crmContacts,
  crmOpportunities,
  crmTasks,
  inboundMessages,
} from "../../drizzle/schema";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  createLiveCallSession: vi.fn(),
  getTodayWork: vi.fn(),
}));
vi.mock("../db", () => ({
  getDb: mocks.getDb,
  createLiveCallSession: mocks.createLiveCallSession,
}));
vi.mock("../today", () => ({ getTodayWork: mocks.getTodayWork }));

import { startLiveCallFromToday } from "./context";

function databaseWith(rows: Map<unknown, unknown[]>) {
  return {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        const result = rows.get(table) || [];
        const chain = {
          where: vi.fn(() => chain),
          orderBy: vi.fn(() => chain),
          limit: vi.fn(async (count: number) => result.slice(0, count)),
        };
        return chain;
      }),
    })),
  };
}

describe("Today to Live Call verified CRM context", () => {
  beforeEach(() => {
    mocks.getDb.mockReset();
    mocks.createLiveCallSession.mockReset().mockResolvedValue(91);
    mocks.getTodayWork.mockReset();
  });

  it("starts a call with exact organisation-scoped contact, task and opportunity IDs", async () => {
    const opportunity = {
      id: 44,
      organisationId: 7,
      connectedSystemId: 8,
      externalId: "opportunity-8",
      contactExternalId: "contact-8",
      companyExternalId: "company-8",
      ownerExternalId: "owner-8",
      name: "Renewal",
      pipeline: "Sales",
      stage: "Qualified",
      reasons: ["Callback due today"],
      raw: {},
    };
    mocks.getTodayWork.mockResolvedValue({
      queues: { priority: [opportunity] },
    });
    mocks.getDb.mockResolvedValue(
      databaseWith(
        new Map([
          [
            crmContacts,
            [
              {
                id: 3,
                organisationId: 7,
                connectedSystemId: 8,
                externalId: "contact-8",
                companyExternalId: "company-8",
                ownerExternalId: "owner-8",
                firstName: "John",
                lastName: "Smith",
                email: "john@example.test",
                phone: "+27820000000",
              },
            ],
          ],
          [crmOpportunities, [opportunity]],
          [connectedSystems, [{ id: 8, organisationId: 7, provider: "genie" }]],
          [crmCompanies, [{ name: "Example Company" }]],
          [crmTasks, [{ externalId: "task-8", title: "Pricing callback" }]],
          [crmActivities, [{ activityType: "email", body: "Sent pricing" }]],
          [inboundMessages, [{ subject: "Re: pricing", body: "Please call" }]],
        ])
      )
    );
    const result = await startLiveCallFromToday({
      userId: 2,
      organisationId: 7,
      opportunityId: 44,
    });
    expect(result).toMatchObject({
      callSessionId: 91,
      context: {
        connectedSystemId: 8,
        contactExternalId: "contact-8",
        taskExternalId: "task-8",
        opportunityExternalId: "opportunity-8",
      },
    });
    expect(mocks.createLiveCallSession).toHaveBeenCalledWith(
      expect.objectContaining({
        organisationId: 7,
        crmContext: expect.objectContaining({
          contactExternalId: "contact-8",
          taskExternalId: "task-8",
          opportunityExternalId: "opportunity-8",
        }),
      })
    );
  });

  it("rejects a Today ID that is not in the user's scoped queue", async () => {
    mocks.getTodayWork.mockResolvedValue({ queues: { priority: [] } });
    await expect(
      startLiveCallFromToday({
        userId: 2,
        organisationId: 7,
        opportunityId: 999,
      })
    ).rejects.toThrow("not available to this user and organisation");
  });
});
