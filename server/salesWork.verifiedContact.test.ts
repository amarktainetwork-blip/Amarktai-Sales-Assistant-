import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getDb: vi.fn(),
  recordAudit: vi.fn(async () => undefined),
}));

vi.mock("./db", () => ({
  getDb: m.getDb,
  recordAudit: m.recordAudit,
}));

import {
  completeCallbackWorkAfterVerifiedCall,
  resolveSalesWorkAfterVerifiedAction,
} from "./salesWork";

function fakeDb(selectRows: unknown[] = []) {
  const updateWhere = vi.fn(async () => [{ affectedRows: 1 }]);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  const limit = vi.fn(async () => selectRows);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { select, update, updateWhere };
}

describe("verified customer work lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the first-contact lead alert after a verified call even when no callback work row exists", async () => {
    const db = fakeDb([]);
    m.getDb.mockResolvedValue(db);

    const callbacks = await completeCallbackWorkAfterVerifiedCall({
      userId: 2,
      organisationId: 8,
      contactExternalId: "contact-1",
    });

    expect(callbacks).toBe(0);
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(m.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "sales_work_resolved_by_verified_contact",
        metadata: expect.objectContaining({
          contactExternalId: "contact-1",
          reason: "verified_call",
        }),
      })
    );
  });

  it("resolves the first-contact lead alert after verified CRM task completion", async () => {
    const db = fakeDb([{ contactExternalId: "contact-2" }]);
    m.getDb.mockResolvedValue(db);

    await expect(
      resolveSalesWorkAfterVerifiedAction({
        userId: 2,
        organisationId: 8,
        actionType: "complete_active_task",
        payload: { taskExternalId: "task-2" },
      })
    ).resolves.toBe(true);

    expect(db.update).toHaveBeenCalledTimes(2);
    expect(m.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "sales_work_resolved_by_verified_contact",
        metadata: expect.objectContaining({
          contactExternalId: "contact-2",
          reason: "verified_task_completion",
        }),
      })
    );
  });
});
