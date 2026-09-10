import { describe, expect, it } from "vitest";
import {
  deterministicTodayAnswer,
  shouldUseDeterministicTodayAnswer,
} from "./assistantRoutes";

describe("zero-model Assistant CRM answers", () => {
  it("routes ordinary Today questions to deterministic truth but leaves write-like commands governed", () => {
    expect(
      shouldUseDeterministicTodayAnswer({ query: "Show me my new leads" })
    ).toBe(true);
    expect(
      shouldUseDeterministicTodayAnswer({ query: "Who should I call next?" })
    ).toBe(true);
    expect(
      shouldUseDeterministicTodayAnswer({ query: "Create a callback for Jamie" })
    ).toBe(false);
    expect(
      shouldUseDeterministicTodayAnswer({ query: "Remind me to call Jamie" })
    ).toBe(false);
    expect(
      shouldUseDeterministicTodayAnswer({
        query: "What tasks are overdue?",
        contactId: 42,
      })
    ).toBe(false);
  });

  it("answers newest-lead requests directly from synchronized CRM truth", () => {
    const response = deterministicTodayAnswer("Show my newest leads", {
      queues: {
        newLeads: [
          {
            firstName: "Jamie",
            lastName: "Test",
            email: "jamie@example.test",
            externalId: "genie-lead-91",
            lifecycleStage: "New",
          },
        ],
      },
    } as never);
    expect(response).toMatchObject({
      suggestedAction: { path: "/customers" },
    });
    expect(response?.content).toContain("Jamie Test — New");
  });
});
