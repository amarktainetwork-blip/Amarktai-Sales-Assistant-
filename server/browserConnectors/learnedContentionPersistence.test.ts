import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  row: {
    id: 1,
    status: "LIVE_PROVEN",
    evidence: { verified: true },
    lastSuccessAt: new Date("2026-09-01"),
    lastError: null,
  },
  update: vi.fn(),
  event: vi.fn(),
}));
vi.mock("../db", () => ({
  getDb: async () => ({
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [state.row] }) }),
    }),
    update: state.update,
  }),
  recordAudit: vi.fn(),
}));
vi.mock("../observability/events", () => ({
  recordOperationalEvent: state.event,
}));
import { recordLearnedRuntimeFailure } from "./runtimeFailure";

beforeEach(() => {
  state.update.mockClear();
  state.event.mockClear();
});
describe("learned proof survives transient contention", () => {
  it.each([
    "CRM_VIEWER_HUMAN_CONTROL_ACTIVE",
    "CRM_VIEWER_AGENT_CONTROL_ACTIVE",
    "CRM_BROWSER_CONTROL_LEASE_LOST",
  ])("preserves the persisted proof for %s", async detail => {
    const before = structuredClone(state.row);
    await recordLearnedRuntimeFailure({
      organisationId: 7,
      connectedSystemId: 9,
      operationKey: "contact.read",
      version: 2,
      correlationId: "contention-test",
      detail,
    });
    expect(state.update).not.toHaveBeenCalled();
    expect(state.row).toEqual(before);
    expect(state.event).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: "browser_operation_retryable" })
    );
  });
});
