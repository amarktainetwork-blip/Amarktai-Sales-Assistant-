import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const assistantPage = readFileSync(
  new URL("../client/src/pages/Assistant.tsx", import.meta.url),
  "utf8"
);
const assistantRoute = readFileSync(
  new URL("./assistantRoutes.ts", import.meta.url),
  "utf8"
);

describe("client-handover AmarktAI contract", () => {
  it("uses one full-page contextual conversation and one integrated composer", () => {
    expect(assistantPage).toContain("data-assistant-workspace");
    expect(assistantPage).toContain(
      "I already have the sales workspace context."
    );
    expect(assistantPage).toContain('aria-label="AmarktAI"');
    expect(assistantPage).not.toContain("Try asking me");
    expect(assistantPage).not.toContain("<Bot");
    expect(assistantPage.match(/<Textarea/g)).toHaveLength(1);
    for (const prompt of [
      "Who should I contact next?",
      "Prepare my next call",
      "What needs my attention?",
      "Draft a follow-up",
    ])
      expect(assistantPage).toContain(prompt);
  });

  it("greets with the signed-in user's first name", () => {
    expect(assistantPage).toContain("useAuth()");
    expect(assistantPage).toContain(
      "organisation.data?.memberOnboarding.preferredName"
    );
    expect(assistantPage).toContain("user?.name?.trim().split");
    expect(assistantPage).toContain("Good {greeting}, {firstName}.");
  });

  it("wires scoped relevant memory and personal context into /api/assistant", () => {
    expect(assistantRoute).toContain("listRelevantAssistantMemories");
    expect(assistantRoute).toContain(
      "organisationId: membership.organisationId"
    );
    expect(assistantRoute).toContain(
      "membership.memberOnboarding.preferredName"
    );
    expect(assistantRoute).toContain("user?.name?.trim().split");
    expect(assistantRoute).toContain(
      "personalSalesGoal: membership.memberOnboarding.primaryGoal"
    );
    expect(assistantRoute).toContain("relevantMemory: relevantMemory.map");
    expect(assistantRoute).toContain("isSafeAssistantMemory");
  });
});
