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
      "You handle the conversation. AmarktAI handles the preparation,"
    );
    expect(assistantPage).toContain('aria-label="AmarktAI"');
    expect(assistantPage).not.toContain("Try asking me");
    expect(assistantPage).not.toContain("<Bot");
    expect(assistantPage.match(/<Textarea/g)).toHaveLength(1);
    for (const prompt of [
      "Prepare me for this call",
      "Summarise the customer history",
      "What should I ask next?",
      "Draft the right follow-up — don't send",
      "Show me the approved templates available here",
    ])
      expect(assistantPage).toContain(prompt);
  });

  it("greets with the signed-in user's first name", () => {
    expect(assistantPage).toContain("useAuth()");
    expect(assistantPage).toContain(
      "organisation.data?.memberOnboarding.preferredName"
    );
    expect(assistantPage).toContain("user?.name?.trim().split");
    expect(assistantPage).toContain(
      "Your sales assistant is ready, ${firstName}."
    );
  });

  it("isolates chat state and asynchronous responses when the customer changes", () => {
    expect(assistantPage).toContain("const switchCustomer = useCallback");
    expect(assistantPage).toContain("requestVersion.current += 1");
    expect(assistantPage).toContain("setMessages([])");
    expect(assistantPage).toContain('setDraft("")');
    expect(assistantPage).toContain(
      "if (requestVersion.current !== activeRequest) return"
    );
    expect(assistantPage).toContain("switchCustomer(next.contactId)");
    expect(assistantPage).toContain("window.history.replaceState");
    expect(assistantPage).toContain('params.set("contactId"');
    expect(assistantPage).toContain(
      "The call workspace could not open. Nothing was changed."
    );
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
    expect(assistantRoute).toContain("getClientActionConfiguration");
    expect(assistantRoute).toContain(
      "No approved communication templates are published"
    );
  });
});
