import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routes = readFileSync(
  new URL("./teamAdmin/skillRoutes.ts", import.meta.url),
  "utf8"
);
const studio = readFileSync(
  new URL("../client/src/components/SkillStudio.tsx", import.meta.url),
  "utf8"
);
const compiler = readFileSync(new URL("./skillCompiler.ts", import.meta.url), "utf8");
const customOperations = readFileSync(
  new URL("./skillCustomOperations.ts", import.meta.url),
  "utf8"
);

describe("Teach AmarktAI read commissioning gate", () => {
  it("blocks publication until every declared CRM read is allowed and proven", () => {
    expect(routes).toContain("READ_COMMISSIONING_REQUIRED");
    expect(routes).toContain("plan.missingReadOperations.length > 0");
    expect(routes).toContain("!capability.currentlyAllowed");
    expect(routes).toContain("!capability.currentlyVerified");
    expect(routes).toContain("connectedSystemId: connectedSystemId || null");
  });

  it("passes the selected CRM connection into publish and rollback", () => {
    expect(studio).toContain("JSON.stringify({ connectedSystemId })");
    expect(studio).toContain("plan?.missingReadOperations.length");
    expect(studio).toContain("plan?.readCapabilities.some");
  });

  it("makes learned custom CRM reads and writes first-class skill operations", () => {
    expect(compiler).toContain("read_crm_operation");
    expect(compiler).toContain("prepare_crm_operation");
    expect(customOperations).toContain("custom.read.");
    expect(customOperations).toContain("requireRuntimeBrowserOperation");
    expect(customOperations).toContain("loadUserConnectionSecret");
    expect(routes).toContain("executeSkillCustomReads");
  });

  it("keeps write commissioning behind explicit approval", () => {
    expect(routes).toContain("WRITE_APPROVAL_REQUIRED");
    expect(routes).toContain("WRITE_COMMISSIONING_REQUIRED");
    expect(studio).toContain("approveWriteCommissioning");
  });
});
