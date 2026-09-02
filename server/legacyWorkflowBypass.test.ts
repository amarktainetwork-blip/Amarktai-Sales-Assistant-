import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("legacy workflow preparation boundary", () => {
  it("cannot prepare external actions from a lead/display label", () => {
    const routers = readFileSync("server/routers.ts", "utf8");
    const start = routers.indexOf("prepareWorkflow: secondFactorProcedure");
    const end = routers.indexOf("reviewAction:", start);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const legacyRoute = routers.slice(start, end);
    expect(legacyRoute).toContain("Legacy workflow preparation is disabled");
    expect(legacyRoute).toContain("exact CRM customer context");
    expect(legacyRoute).not.toContain("buildWorkflowPlan");
    expect(legacyRoute).not.toContain("createWorkflowRun");
    expect(legacyRoute).not.toContain("routeConnectedSystemActions");
    expect(routers).not.toContain(
      'import { buildWorkflowPlan } from "./workflowRules";'
    );
  });

  it("keeps legacy workflow pages redirected to the governed Assistant", () => {
    const app = readFileSync("client/src/App.tsx", "utf8");
    const workspace = readFileSync("client/src/pages/Workspace.tsx", "utf8");

    expect(app).toContain('<LegacyRedirect to="/assistant" />');
    expect(workspace).not.toContain("result.actionCount");
  });
});
