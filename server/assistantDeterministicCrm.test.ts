import { describe, expect, it } from "vitest";
import { deterministicTodayAnswer } from "./assistantRoutes";

describe("zero-model Assistant CRM answers", () => {
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
