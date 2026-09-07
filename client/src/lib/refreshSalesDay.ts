type FetchResponse = Pick<Response, "ok" | "json">;

type RefreshSalesDayOptions = {
  fetcher: (input: string, init?: RequestInit) => Promise<FetchResponse>;
  invalidateToday: () => Promise<unknown>;
  invalidateCustomers: () => Promise<unknown>;
  refetchToday: () => Promise<{ isError: boolean; error?: unknown }>;
};

export async function refreshSalesDay({
  fetcher,
  invalidateToday,
  invalidateCustomers,
  refetchToday,
}: RefreshSalesDayOptions): Promise<{ mailboxWarning: boolean }> {
  let mailboxWarning = false;

  try {
    const statusResponse = await fetcher("/api/mailbox", {
      credentials: "include",
    });
    if (!statusResponse.ok) {
      mailboxWarning = true;
    } else {
      const status = (await statusResponse.json()) as { connected?: boolean };
      if (status.connected) {
        const syncResponse = await fetcher("/api/mailbox/sync", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        mailboxWarning = !syncResponse.ok;
      }
    }
  } catch {
    mailboxWarning = true;
  }

  await Promise.all([invalidateToday(), invalidateCustomers()]);
  const result = await refetchToday();
  if (result.isError) {
    throw result.error ?? new Error("Sales day refresh failed");
  }

  return { mailboxWarning };
}
