import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) =>
  readFileSync(path.resolve(process.cwd(), file), "utf8");

describe("Phase 2 daily salesperson workflow", () => {
  it("makes Today a work-led call queue rather than an opportunity ageing dashboard", () => {
    const today = read("client/src/pages/Today.tsx");
    const service = read("server/today.ts");
    const queue = read("server/todayCallQueue.ts");

    expect(today).toContain(
      "Make the calls. AmarktAI handles the admin around them."
    );
    expect(today).toContain("today.data?.queues.callQueue");
    expect(today).not.toContain("today.data?.queues.priority");
    expect(today).toContain("startCall.mutate");
    expect(today).toContain("/customers?contactId=");
    expect(today).toContain("/reviews");

    expect(service).toContain("buildTodayCallQueue({");
    expect(service).toContain("callQueue,");
    expect(service).toContain("personalOwnerSql(");
    expect(service).toContain(
      "inArray(crmContacts.externalId, workContactExternalIds)"
    );
    expect(queue).toContain(
      'primaryKind: "overdue_task" | "inbound_reply" | "due_today"'
    );
    expect(queue).toContain("if (!contact) return");
  });

  it("keeps one exact customer context through Customers, AmarktAI and Calls", () => {
    const customers = read("client/src/pages/Customers.tsx");
    const assistant = read("client/src/pages/Assistant.tsx");
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
    expect(assistant).toContain('params.get("contactId")');
    expect(assistant).toContain('label: "Open Review"');

    expect(layout).toContain('label: "Today"');
    expect(layout).toContain("Daily flow");

    expect(calls).toContain("trpc.sales.customerDetail.useQuery");
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
