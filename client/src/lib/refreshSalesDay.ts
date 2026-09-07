type FetchResponse = Pick<Response, "ok" | "json">;

type RefreshSalesDayOptions = {
  fetcher: (input: string, init?: RequestInit) => Promise<FetchResponse>;
  syncCrm: () => Promise<{
    checked?: number;
    failed?: number;
    lastSuccessfulAt?: string | null;
  }>;
  invalidateToday: () => Promise<unknown>;
  invalidateCustomers: () => Promise<unknown>;
  refetchToday: () => Promise<{ isError: boolean; error?: unknown }>;
};

export async function refreshSalesDay({
  fetcher,
  syncCrm,
  invalidateToday,
  invalidateCustomers,
  refetchToday,
}: RefreshSalesDayOptions): Promise<{
  mailboxWarning: boolean;
  crmWarning: boolean;
  lastSuccessfulAt: string | null;
}> {
  let mailboxWarning = false;
  let crmWarning = false;
  let lastSuccessfulAt: string | null = null;

  try {
    const crm = await syncCrm();
    crmWarning = Boolean(crm.failed) || crm.checked === 0;
    lastSuccessfulAt = crm.lastSuccessfulAt || null;
  } catch {
    crmWarning = true;
  }

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

  return { mailboxWarning, crmWarning, lastSuccessfulAt };
}
