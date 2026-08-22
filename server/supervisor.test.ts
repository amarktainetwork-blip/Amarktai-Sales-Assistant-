import { describe, expect, it } from "vitest";
import { routeSalesCommand } from "./supervisor";

describe("supervisor routing", () => {
  it("routes final closure commands into the governed workflow", () => {
    expect(routeSalesCommand("Close the final unsuccessful contact")).toMatchObject({ intent: "workflow", workflowKey: "final_close" });
  });
  it("requires factual notes for live coaching", () => {
    expect(routeSalesCommand("Help with this objection on my call")).toMatchObject({ intent: "coaching", agentKey: "conversation_coach" });
  });
});
