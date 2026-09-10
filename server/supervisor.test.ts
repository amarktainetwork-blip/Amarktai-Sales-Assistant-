import { describe, expect, it } from "vitest";
import { routeSalesCommand } from "./supervisor";

describe("supervisor routing", () => {
  it("routes final closure commands into the governed workflow", () => {
    expect(
      routeSalesCommand("Close the final unsuccessful contact")
    ).toMatchObject({ intent: "workflow", workflowKey: "final_close" });
  });
  it("routes natural customer closure and call-outcome language into configured workflows", () => {
    expect(routeSalesCommand("Close this candidate as lost")).toMatchObject({
      intent: "workflow",
      workflowKey: "final_close",
    });
    expect(routeSalesCommand("Mark this candidate as answered")).toMatchObject({
      intent: "workflow",
      workflowKey: "post_consultation_follow_up",
    });
    expect(routeSalesCommand("Update this customer: no answer")).toMatchObject({
      intent: "workflow",
      workflowKey: "post_consultation_follow_up",
    });
  });
  it("routes explicit objection help to the objection specialist", () => {
    expect(
      routeSalesCommand("Help with this objection on my call")
    ).toMatchObject({ intent: "coaching", agentKey: "objection_handler" });
  });
  it.each([
    ["Who has been waiting for us?", "sales_comms_tracker"],
    ["What did we promise this customer?", "promise_tracker"],
    ["Show me where we are losing revenue", "revenue_leakage"],
    ["Which deals are at risk?", "relationship_health"],
    ["Show pipeline hygiene issues", "pipeline_hygiene"],
    ["Who should I contact first today?", "attention_engine"],
    ["Manager watchtower: who is not following up?", "manager_watchtower"],
  ])("routes %s to %s", (command, agentKey) => {
    expect(routeSalesCommand(command)).toMatchObject({
      intent: "analytics",
      agentKey,
    });
  });
});
