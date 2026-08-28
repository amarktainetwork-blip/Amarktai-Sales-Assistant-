import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GOVERNED_EVIDENCE_AGENT_KEYS,
  isGovernedEvidenceAgent,
} from "./governedEvidenceAgents";

const expected = [
  "sales_comms_tracker",
  "promise_tracker",
  "revenue_leakage",
  "relationship_health",
  "pipeline_hygiene",
  "attention_engine",
  "manager_watchtower",
];

describe("Agent Desk governed evidence dispatch", () => {
  it("recognizes exactly the seven commissioned CRM-evidence specialists", () => {
    expect([...GOVERNED_EVIDENCE_AGENT_KEYS]).toEqual(expected);
    for (const key of expected) expect(isGovernedEvidenceAgent(key)).toBe(true);
    for (const key of [
      "conversation_coach",
      "knowledge_guide",
      "supervisor",
      "custom.write.send.quote",
    ])
      expect(isGovernedEvidenceAgent(key)).toBe(false);
  });

  it("diverts Agent Desk evidence specialists before generic model readiness", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./genx.ts", import.meta.url)),
      "utf8"
    );
    const diversion = source.indexOf(
      "!input.billing && GOVERNED_EVIDENCE_AGENT_KEYS.has(input.agentKey)"
    );
    const evidenceImport = source.indexOf('"./governedEvidenceAgents"');
    const readiness = source.indexOf(
      "const readiness = getGenxReadiness();",
      source.indexOf("export async function runGenxAgent")
    );
    expect(diversion).toBeGreaterThan(0);
    expect(evidenceImport).toBeGreaterThan(diversion);
    expect(readiness).toBeGreaterThan(evidenceImport);
    expect(source).toContain("currentAiRequestIdentity()");
    expect(source).toContain('provider: "workspace_evidence_blocked"');
  });

  it("keeps explicitly billed bounded extraction out of the diversion", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./genx.ts", import.meta.url)),
      "utf8"
    );
    expect(source).toContain(
      "if (!input.billing && GOVERNED_EVIDENCE_AGENT_KEYS.has(input.agentKey))"
    );
    const watchtowerSource = readFileSync(
      fileURLToPath(new URL("./salesCommsWatchtower.ts", import.meta.url)),
      "utf8"
    );
    expect(watchtowerSource).toContain('agentKey: "promise_tracker"');
    expect(watchtowerSource).toContain('feature: "sales_promise_tracker"');
  });
});
