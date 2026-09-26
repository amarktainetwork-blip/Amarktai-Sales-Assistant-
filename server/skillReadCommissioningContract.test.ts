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

  it("keeps write commissioning behind explicit approval", () => {
    expect(routes).toContain("WRITE_APPROVAL_REQUIRED");
    expect(routes).toContain("WRITE_COMMISSIONING_REQUIRED");
    expect(studio).toContain("approveWriteCommissioning");
  });
});
