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
      "promise_tracker",
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
    for (const key of [
      "sales_intelligence",
      "promise_tracker",
      "sales_comms_tracker",
      "revenue_leakage",
      "relationship_health",
      "pipeline_hygiene",
      "attention_engine",
      "manager_watchtower",
      "pipeline_planner",
      "crm_context",
      "crm_router",
      "communications",
    ]) {
      expect(agentRuntimeStatus(key, noCrm)).toBe("NEEDS_CONNECTION");
    }
  });

  it("allows deterministic watchtower agents to run without GenX when synchronized CRM reads are ready", () => {
    const noGenx = { ...base, genxReady: false };
    for (const key of [
      "sales_comms_tracker",
      "revenue_leakage",
      "relationship_health",
      "pipeline_hygiene",
      "attention_engine",
      "manager_watchtower",
    ]) {
      expect(agentRuntimeStatus(key, noGenx)).toBe("READY");
    }
    expect(agentRuntimeStatus("promise_tracker", noGenx)).toBe(
      "NEEDS_CONNECTION"
    );
  });

  it("allows text coaching agents to run when GenX is live without coupling them to transport status", () => {
    expect(agentRuntimeStatus("conversation_coach", base)).toBe("READY");
    expect(agentRuntimeStatus("notes_agent", base)).toBe("READY");
  });

  it("live integration verification probes model agents without bypassing workspace evidence guards", () => {
    const source = readFileSync(
      path.resolve("server/verifyIntegrations.ts"),
      "utf8"
    );
    const evaluator = readFileSync(
      path.resolve("server/productionAgentProbe.ts"),
      "utf8"
    );
    expect(source).toContain("for (const agent of AGENT_CATALOG)");
    expect(source).toContain("if (!agent.requiresModel)");
    expect(source).toContain("const response = await runGenxAgent({");
    expect(source).toContain("evaluateProductionAgentProbe({");
    expect(evaluator).toContain('status: "GENX_LIVE_PROVEN"');
    expect(evaluator).toContain('provider !== "workspace_evidence_blocked"');
    expect(source).toContain("if (agentVerification.failed) failed = true");
  });
});
