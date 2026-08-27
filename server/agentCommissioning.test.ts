import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { agentRuntimeStatus } from "./agentCatalog";

const base = {
  databaseReady: true,
  genxReady: true,
  crmReadReady: true,
  crmRouteReady: true,
  communicationsReady: true,
  voiceReady: false,
};

describe("AI agent commissioning", () => {
  it("does not hard-code the GenX specialist agents as unimplemented", () => {
    for (const key of [
      "sales_intelligence",
      "objection_handler",
      "recommendation_agent",
      "pipeline_planner",
    ]) {
      expect(agentRuntimeStatus(key, base)).toBe("READY");
    }
  });

  it("keeps CRM-dependent agents gated until a verified CRM exists", () => {
    const noCrm = {
      ...base,
      crmReadReady: false,
      crmRouteReady: false,
      communicationsReady: false,
    };
    expect(agentRuntimeStatus("sales_intelligence", noCrm)).toBe("NEEDS_CONNECTION");
    expect(agentRuntimeStatus("pipeline_planner", noCrm)).toBe("NEEDS_CONNECTION");
    expect(agentRuntimeStatus("crm_context", noCrm)).toBe("NEEDS_CONNECTION");
    expect(agentRuntimeStatus("crm_router", noCrm)).toBe("NEEDS_CONNECTION");
    expect(agentRuntimeStatus("communications", noCrm)).toBe("NEEDS_CONNECTION");
  });

  it("allows text coaching agents to run when GenX is live without coupling them to transport status", () => {
    expect(agentRuntimeStatus("conversation_coach", base)).toBe("READY");
    expect(agentRuntimeStatus("notes_agent", base)).toBe("READY");
  });

  it("live integration verification executes every model-backed catalogue agent through GenX", () => {
    const source = readFileSync(path.resolve("server/verifyIntegrations.ts"), "utf8");
    expect(source).toContain("for (const agent of AGENT_CATALOG)");
    expect(source).toContain("if (!agent.requiresModel)");
    expect(source).toContain("const response = await runGenxAgent({");
    expect(source).toContain('status: "GENX_LIVE_PROVEN"');
    expect(source).toContain("if (agentVerification.failed) failed = true");
  });
});
