import { describe, expect, it } from "vitest";
import { routeSalesCommand } from "./supervisor";

describe("supervisor routing", () => {
  it("routes an initial-contact instruction into the governed generic workflow", () => {
    expect(routeSalesCommand("Prepare first contact for this new uncontacted lead")).toMatchObject({ intent: "workflow", workflowKey: "first_contact" });
  });
  it("requires clarification rather than accepting obsolete customer-specific commands", () => {
    expect(routeSalesCommand("Close the final unsuccessful Cyber lead")).toMatchObject({ intent: "clarification" });
  });
  it("requires factual notes for live coaching", () => {
    expect(routeSalesCommand("Help with this objection on my call")).toMatchObject({ intent: "coaching", agentKey: "conversation_coach" });
  });
});
