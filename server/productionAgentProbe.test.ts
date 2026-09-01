import { describe, expect, it } from "vitest";
import { evaluateProductionAgentProbe } from "./productionAgentProbe";

describe("production agent probes", () => {
  it("treats the promise tracker workspace guard as required security proof", () => {
    expect(
      evaluateProductionAgentProbe({
        agentKey: "promise_tracker",
        provider: "workspace_evidence_blocked",
        content: "Authenticated workspace evidence is required.",
      })
    ).toEqual({
      status: "AUTHENTICATED_WORKSPACE_GUARD_PROVEN",
      provider: "workspace_evidence_blocked",
      genxTransportVerifiedSeparately: true,
    });
  });

  it("rejects a governed evidence agent that bypasses its workspace boundary", () => {
    expect(() =>
      evaluateProductionAgentProbe({
        agentKey: "promise_tracker",
        provider: "genx",
        content: "Unsafe generic response",
      })
    ).toThrow("bypassed its authenticated workspace boundary");
  });

  it("still requires ordinary model-backed agents to use live GenX", () => {
    expect(
      evaluateProductionAgentProbe({
        agentKey: "conversation_coach",
        provider: "genx",
        content: "Live response",
      })
    ).toEqual({
      status: "GENX_LIVE_PROVEN",
      provider: "genx",
      responseCharacters: 13,
    });
    expect(() =>
      evaluateProductionAgentProbe({
        agentKey: "conversation_coach",
        provider: "workspace_evidence_blocked",
        content: "",
      })
    ).toThrow("instead of the configured production intelligence service");
  });
});
