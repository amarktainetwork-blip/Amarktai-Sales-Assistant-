import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  create: vi.fn(),
  route: vi.fn(),
  auto: vi.fn(),
  genx: vi.fn(),
}));
vi.mock("./db", () => ({
  createWorkflowRun: m.create,
  listActionProposals: vi.fn(async () => []),
  searchApprovedKnowledge: vi.fn(async () => []),
}));
vi.mock("./organisationWorkspace", () => ({
  getOrganisationWorkspaceContext: vi.fn(async () => ({
    customerModel: "individual_consumer",
    organisation: {
      timezone: "Europe/London",
      locale: "en-GB",
      currency: "GBP",
    },
    businessContext: { industry: "training" },
  })),
}));
vi.mock("./connectedSystems", () => ({
  listConnectedSystemsForUser: vi.fn(async () => []),
}));
vi.mock("./crmRouter", () => ({ routeConnectedSystemActionsForUser: m.route }));
vi.mock("./genx", () => ({ runGenxAgent: m.genx }));
vi.mock("./automationPolicy", () => ({
  getAutomationPolicy: vi.fn(async () => ({})),
}));
vi.mock("./governedActions", () => ({ executeAutoPreapprovedActions: m.auto }));
vi.mock("./assistantCustomerContext", () => ({
  requestUsesCurrentCustomerReference: () => true,
  resolveAssistantCustomerContext: vi.fn(async () => ({
    contactName: "Alex",
    firstName: "Alex",
    contactExternalId: "contact-301",
    connectedSystemId: 8,
    provider: "genie",
    email: "alex@example.test",
    targetVerification: { source: "assistant_customer_selector" },
  })),
}));
vi.mock("./clientActionConfiguration", () => ({
  getClientActionConfiguration: vi.fn(async () => ({
    templates: {},
    approvedSenders: { sms: [], whatsapp: [] },
    requiredPostconditions: {},
  })),
}));
vi.mock("./communications", async importOriginal => ({
  ...(await importOriginal<typeof import("./communications")>()),
  getOutboundSuppressionStatus: vi.fn(async () => ({
    suppressed: false,
    verified: true,
  })),
}));
import {
  isDraftOnly,
  tryPrepareDirectAssistantAction,
} from "./assistantDirectActions";
describe("draft preparation is separate from sending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.create.mockResolvedValue(123);
    m.genx.mockResolvedValue({
      content:
        "Hi Alex, I am following up on your enquiry. Please let me know a convenient time to talk.",
    });
    m.route.mockImplementation(async ({ actions }: any) =>
      actions.map((a: any) => ({
        ...a,
        payload: {
          ...a.payload,
          crmRoute: { routable: false, reason: "No mailbox" },
        },
      }))
    );
  });
  it.each([
    "Draft a follow-up email for this customer, don't send it.",
    "Prepare an email without sending it.",
    "Write an email, do not send it.",
  ])("recognizes explicit non-send intent: %s", request =>
    expect(isDraftOnly(request)).toBe(true)
  );
  it("creates a non-executable Review draft without Microsoft and includes business context", async () => {
    const r = await tryPrepareDirectAssistantAction({
      userId: 2,
      organisationId: 8,
      contactId: 301,
      request: "Draft a follow-up email, don't send it.",
    });
    expect(r?.reviewRequired).toBe(true);
    expect(m.create).toHaveBeenCalledOnce();
    const a = m.create.mock.calls[0][0].actions[0];
    expect(a.payload).toMatchObject({
      draftOnly: true,
      executionReady: false,
      reviewRequired: true,
      crmRoute: { routable: false },
    });
    expect(m.auto).not.toHaveBeenCalled();
    expect(
      JSON.parse(m.genx.mock.calls[0][0].workingContext).workspace
    ).toMatchObject({
      customerModel: "individual_consumer",
      businessContext: { industry: "training" },
    });
  });
  it("blocks normal send without a route", async () => {
    const r = await tryPrepareDirectAssistantAction({
      userId: 2,
      organisationId: 8,
      request: "Send an email to this customer",
    });
    expect(r?.content).toBe("No mailbox");
    expect(m.create).not.toHaveBeenCalled();
    expect(m.auto).not.toHaveBeenCalled();
  });
  it("retains a valid route without automatic sending", async () => {
    m.route.mockImplementation(async ({ actions }: any) =>
      actions.map((a: any) => ({
        ...a,
        payload: {
          ...a.payload,
          crmRoute: {
            routable: true,
            provider: "microsoft_delegated",
            mailbox: "advisor@example.test",
          },
        },
      }))
    );
    await tryPrepareDirectAssistantAction({
      userId: 2,
      organisationId: 8,
      request: "Draft an email",
    });
    expect(m.create.mock.calls[0][0].actions[0].payload).toMatchObject({
      draftOnly: true,
      executionReady: false,
      crmRoute: { routable: true, mailbox: "advisor@example.test" },
    });
    expect(m.auto).not.toHaveBeenCalled();
  });
});
