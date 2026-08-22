import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireLocalHttpContext: vi.fn(),
  getDb: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("../httpAuth", () => ({ requireLocalHttpContext: mocks.requireLocalHttpContext }));
vi.mock("../db", () => ({ getDb: mocks.getDb, getUserByEmail: vi.fn(), getUserById: vi.fn(), recordAudit: mocks.recordAudit }));
vi.mock("../localAuth", () => ({ isLocalAuthMode: vi.fn(() => true) }));
vi.mock("../smtp", () => ({ getSmtpReadiness: vi.fn(), sendEmail: vi.fn() }));

import { registerTeamAdminRoutes } from "./routes";

type Handler = (req: any, res: any) => Promise<unknown>;

describe("team-admin CRM owner mapping boundary", () => {
  const routes = new Map<string, Handler>();
  const app = {
    get: vi.fn((path: string, handler: Handler) => routes.set(`GET ${path}`, handler)),
    post: vi.fn((path: string, handler: Handler) => routes.set(`POST ${path}`, handler)),
    put: vi.fn((path: string, handler: Handler) => routes.set(`PUT ${path}`, handler)),
    patch: vi.fn((path: string, handler: Handler) => routes.set(`PATCH ${path}`, handler)),
  } as any;

  beforeEach(() => {
    routes.clear();
    mocks.requireLocalHttpContext.mockReset();
    mocks.getDb.mockReset();
    mocks.recordAudit.mockReset();
    registerTeamAdminRoutes(app);
  });

  it("denies a cross-tenant mapping request before any database operation", async () => {
    mocks.requireLocalHttpContext.mockRejectedValue(new Error("ACTIVE_ORGANISATION_ACCESS_DENIED"));
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    const handler = routes.get("PUT /api/team-admin/crm-owner-mappings");
    await handler?.({ body: { connectedSystemId: 1, externalUserId: "crm-owner", displayName: "CRM owner" } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: "ACTIVE_ORGANISATION_ACCESS_DENIED" }));
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("denies a cross-tenant pipeline-stage mapping request before any database operation", async () => {
    mocks.requireLocalHttpContext.mockRejectedValue(new Error("ACTIVE_ORGANISATION_ACCESS_DENIED"));
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    const handler = routes.get("PUT /api/team-admin/crm-pipeline-stage-mappings");
    await handler?.({ body: { connectedSystemId: 1, externalPipelineId: "pipeline", externalStageId: "stage", pipelineLabel: "Pipeline", stageLabel: "Stage", category: "won" } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: "ACTIVE_ORGANISATION_ACCESS_DENIED" }));
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
