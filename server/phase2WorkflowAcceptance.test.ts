import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) =>
  readFileSync(path.resolve(process.cwd(), file), "utf8");

describe("Phase 2 daily salesperson workflow", () => {
  it("makes Today a work-led priority queue rather than an opportunity ageing dashboard", () => {
    const today = read("client/src/pages/Today.tsx");
    const service = read("server/today.ts");
    const queue = read("server/todayCallQueue.ts");

    expect(today).toContain("assignedTaskExceptions.length");
    expect(today).toContain("Good morning");
    expect(today).toContain("people need");
    expect(today).toContain("Start with ${current.name}");
    expect(today).toContain('"Start call"');
    expect(today).not.toContain(
      "Work the hottest customer. AmarktAI handles the admin around it."
    );
    expect(today).not.toContain("Customer replies / possible sales");
    expect(today).toContain("{inboundQueue.length} replies");
    expect(today).toContain('navigate("/inbox")');
    expect(today).toContain("today.data?.queues.callQueue");
    expect(today).not.toContain("today.data?.queues.priority");
    expect(today).toContain("startCall.mutate");
    expect(today).toContain("&contactId=${variables.contactId}");
    expect(today).toContain("/customers?contactId=");
    expect(today).toContain("/reviews");

    expect(service).toContain("buildTodayCallQueue({");
    expect(service).toContain("callQueue,");
    expect(service).toContain("personalOwnerSql(");
    expect(service).toContain(
      "inArray(crmContacts.externalId, workContactExternalIds)"
    );
    for (const kind of [
      '"new_lead"',
      '"inbound_reply"',
      '"confirmed_follow_up"',
      '"overdue_task"',
      '"due_today"',
    ])
      expect(queue).toContain(kind);
    expect(queue).toContain("reminderIds");
    expect(queue).toContain("if (!contact) return");
  });

  it("keeps Today fresh and makes Refresh-now bounded for browser CRMs", () => {
    const today = read("client/src/pages/Today.tsx");
    const sync = read("server/crm/sync.ts");

    expect(today).toContain("refetchInterval: 30_000");
    expect(today).toContain("refetchOnWindowFocus: true");
    expect(today).toContain("refetchOnReconnect: true");
    expect(sync).toContain("? syncConnectedSystemRoutine");
    expect(sync).toContain(": syncConnectedSystem;");
  });

  it("keeps one exact customer context through Customers, AmarktAI and Calls", () => {
    const customers = read("client/src/pages/Customers.tsx");
    const assistant = read("client/src/pages/Assistant.tsx");
    const inbox = read("client/src/pages/Inbox.tsx");
    const inboxService = read("server/salesInbox.ts");
    const app = read("client/src/App.tsx");
    const layout = read("client/src/components/DashboardLayout.tsx");
    const calls = read("client/src/pages/LiveCalls.tsx");
    const review = read("client/src/pages/Reviews.tsx");

    expect(customers).toContain(
      'new URLSearchParams(window.location.search).get("contactId")'
    );
    expect(customers).toContain("selected.mappedFields");
    expect(customers).toContain("selected.tasks.current");
    expect(customers).toContain("selected.tasks.completed");
    expect(customers).toContain("/assistant?");
    expect(customers).toContain("/calls?contactId=");

    expect(assistant).toContain("trpc.sales.customerDirectory.useQuery");
    expect(assistant).toContain("trpc.sales.customerDetail.useQuery");
    expect(assistant).not.toContain("trpc.sales.customers.useQuery");
    expect(assistant).toContain("requestedAssistantContactId()");
    expect(assistant).toContain(
      "if (contactId || explicitContactId) return;"
    );
    expect(assistant).toContain("explicitContactId");
    expect(customers).toContain("selected?.id ?? selectedId");
    expect(assistant).toContain('label: "Open Review"');

    expect(inbox).toContain("trpc.sales.inbox.useQuery");
    expect(inbox).toContain("trpc.sales.syncInbox.useMutation");
    expect(inbox).toContain("Draft reply");
    expect(inbox).toContain("does not send a response");
    expect(inbox).toContain("Draft reply prepares work for");
    expect(inboxService).toContain("eq(inboundMessages.needsAction, true)");
    expect(app).toContain('<Route path="/inbox" component={Inbox} />');

    expect(layout).toContain('label: "Today"');
    expect(layout).toContain('label: "Inbox"');
    expect(layout).toContain("Daily flow");

    expect(calls).toContain("trpc.sales.customerDetail.useQuery");
    expect(calls).toContain(
      "initialContactId > 0 ? initialContactId : undefined"
    );
    expect(calls).not.toContain("trpc.sales.customers.useQuery");
    expect(calls).toContain('navigate("/reviews")');
    expect(calls).toContain('navigate("/today")');

    expect(review).toContain("const draftOnly = payload.draftOnly === true");
    expect(review).toContain("Draft prepared — sending is offline.");
    expect(review).toContain(
      "No sending route is enabled. Draft stays review-only."
    );
  });
});
