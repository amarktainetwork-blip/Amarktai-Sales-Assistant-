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
  recordAudit: vi.fn(),
  getTodayWork: vi.fn(),
  loadConnectionSecret: vi.fn(),
  toAdapterConnection: vi.fn((system: unknown) => system),
  requireRuntimeBrowserOperation: vi.fn(),
  executeCustomAction: vi.fn(),
}));
vi.mock("../db", () => ({
  getDb: mocks.getDb,
  createLiveCallSession: mocks.createLiveCallSession,
  recordAudit: mocks.recordAudit,
}));
vi.mock("../today", () => ({ getTodayWork: mocks.getTodayWork }));
vi.mock("../connectedSystems", () => ({
  loadConnectionSecret: mocks.loadConnectionSecret,
  toAdapterConnection: mocks.toAdapterConnection,
}));
vi.mock("../browserConnectors/learnedOperations", () => ({
  requireRuntimeBrowserOperation: mocks.requireRuntimeBrowserOperation,
}));
vi.mock("../crm/adapterRegistry", () => ({
  getCrmAdapter: () => ({ executeCustomAction: mocks.executeCustomAction }),
}));

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
    mocks.recordAudit.mockReset().mockResolvedValue(undefined);
    mocks.getTodayWork.mockReset();
    mocks.loadConnectionSecret.mockReset().mockResolvedValue({ credentials: { username: "encrypted-user", password: "encrypted-password" } });
    mocks.requireRuntimeBrowserOperation.mockReset().mockResolvedValue({ status: "LIVE_PROVEN" });
    mocks.executeCustomAction.mockReset().mockResolvedValue({ operation: "dialler.launch", correlationId: "correlation", completedAt: "2026-08-24T10:00:00.000Z" });
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
      callingMode: "external",
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

  it("launches only the LIVE_PROVEN Genie dialler for the normalized contact before opening the companion", async () => {
    const opportunity = {
      id: 44,
      organisationId: 7,
      connectedSystemId: 8,
      externalId: "opportunity-8",
      contactExternalId: "contact-8",
      name: "Renewal",
      reasons: ["Callback due today"],
      raw: {},
    };
    const genie = {
      id: 8,
      organisationId: 7,
      provider: "genie",
      connectionMethod: "browser",
      status: "limited_permissions",
      displayName: "Genie",
      baseUrl: "https://genie.example/login",
      allowedReadCapabilities: [],
      allowedWriteCapabilities: [],
      verifiedCapabilities: [],
      scopes: [],
      configuration: {},
    };
    mocks.getTodayWork.mockResolvedValue({ queues: { priority: [opportunity] } });
    mocks.getDb.mockResolvedValue(databaseWith(new Map([
      [crmContacts, [{ id: 3, organisationId: 7, connectedSystemId: 8, externalId: "contact-8", firstName: "Dummy", lastName: "Customer", phone: "+27000000000" }]],
      [crmOpportunities, [opportunity]],
      [connectedSystems, [genie]],
      [crmCompanies, []],
      [crmTasks, []],
      [crmActivities, []],
      [inboundMessages, []],
    ])));

    const result = await startLiveCallFromToday({ userId: 2, organisationId: 7, opportunityId: 44, callingMode: "genie" });

    expect(mocks.requireRuntimeBrowserOperation).toHaveBeenCalledWith({ organisationId: 7, connectedSystemId: 8, operationKey: "dialler.launch" });
    expect(mocks.executeCustomAction).toHaveBeenCalledWith(expect.objectContaining({
      actionName: "dialler.launch",
      payload: expect.objectContaining({ connectedSystemId: 8, contactExternalId: "contact-8", opportunityExternalId: "opportunity-8" }),
    }));
    expect(result.context.diallerLaunch).toMatchObject({ connectedSystemId: 8, contactExternalId: "contact-8", operation: "dialler.launch" });
    expect(mocks.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ eventType: "genie_dialler_launched", metadata: expect.objectContaining({ executionResult: "success" }) }));
  });

  it("does not create a call session when dialler.launch is not LIVE_PROVEN", async () => {
    const opportunity = { id: 44, organisationId: 7, connectedSystemId: 8, externalId: "opportunity-8", contactExternalId: "contact-8", name: "Renewal", reasons: [], raw: {} };
    mocks.getTodayWork.mockResolvedValue({ queues: { priority: [opportunity] } });
    mocks.getDb.mockResolvedValue(databaseWith(new Map([
      [crmContacts, [{ id: 3, organisationId: 7, connectedSystemId: 8, externalId: "contact-8", firstName: "Dummy", lastName: "Customer" }]],
      [crmOpportunities, [opportunity]],
      [connectedSystems, [{ id: 8, organisationId: 7, provider: "genie", connectionMethod: "browser", status: "limited_permissions", configuration: {} }]],
      [crmCompanies, []], [crmTasks, []], [crmActivities, []], [inboundMessages, []],
    ])));
    mocks.requireRuntimeBrowserOperation.mockRejectedValue(new Error("OPERATION_NOT_LIVE_PROVEN"));

    await expect(startLiveCallFromToday({ userId: 2, organisationId: 7, opportunityId: 44, callingMode: "genie" })).rejects.toThrow("Genie calling still needs to be tested");
    expect(mocks.executeCustomAction).not.toHaveBeenCalled();
    expect(mocks.createLiveCallSession).not.toHaveBeenCalled();
  });
});
