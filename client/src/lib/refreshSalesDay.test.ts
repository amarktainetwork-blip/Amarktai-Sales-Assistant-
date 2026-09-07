import { describe, expect, it, vi } from "vitest";
import { refreshSalesDay } from "./refreshSalesDay";

const response = (ok: boolean, body: unknown = {}) => ({
  ok,
  json: vi.fn().mockResolvedValue(body),
});

function dependencies(fetcher: ReturnType<typeof vi.fn>) {
  return {
    fetcher,
    invalidateToday: vi.fn().mockResolvedValue(undefined),
    invalidateCustomers: vi.fn().mockResolvedValue(undefined),
    refetchToday: vi.fn().mockResolvedValue({ isError: false }),
  };
}

describe("refreshSalesDay", () => {
  it("syncs a connected mailbox before refetching current sales data", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(true, { connected: true }))
      .mockResolvedValueOnce(response(true));
    const deps = dependencies(fetcher);

    await expect(refreshSalesDay(deps)).resolves.toEqual({
      mailboxWarning: false,
    });
    expect(fetcher).toHaveBeenNthCalledWith(1, "/api/mailbox", {
      credentials: "include",
    });
    expect(fetcher).toHaveBeenNthCalledWith(2, "/api/mailbox/sync", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(deps.invalidateToday).toHaveBeenCalledOnce();
    expect(deps.invalidateCustomers).toHaveBeenCalledOnce();
    expect(deps.refetchToday).toHaveBeenCalledOnce();
  });

  it("still refreshes CRM-backed data and reports a mailbox warning when mailbox sync fails", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(true, { connected: true }))
      .mockResolvedValueOnce(response(false));
    const deps = dependencies(fetcher);

    await expect(refreshSalesDay(deps)).resolves.toEqual({
      mailboxWarning: true,
    });
    expect(deps.refetchToday).toHaveBeenCalledOnce();
  });

  it("does not report success when the sales-day refetch returns an error", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("mailbox unavailable"));
    const deps = dependencies(fetcher);
    const failure = new Error("sales data unavailable");
    deps.refetchToday.mockResolvedValue({ isError: true, error: failure });

    await expect(refreshSalesDay(deps)).rejects.toBe(failure);
    expect(deps.invalidateToday).toHaveBeenCalledOnce();
    expect(deps.invalidateCustomers).toHaveBeenCalledOnce();
  });
});
