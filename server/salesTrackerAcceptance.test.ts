import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { authoritativeOpportunityStatus } from "./salesTracker";

describe("read-only Sales Tracker", () => {
  it("uses the authoritative CRM opportunity status to reject lost records in a Won-labelled stage", () => {
    expect(authoritativeOpportunityStatus({ status: "won" })).toBe("won");
    expect(authoritativeOpportunityStatus({ status: "lost" })).toBe("lost");
    expect(authoritativeOpportunityStatus({ status: "unknown" })).toBeNull();
    expect(authoritativeOpportunityStatus({})).toBeNull();
  });

  it("counts only authoritative Won stage mappings and exposes the salesperson tracker", () => {
    const server = readFileSync(path.resolve("server/salesTracker.ts"), "utf8");
    const page = readFileSync(
      path.resolve("client/src/pages/SalesTracker.tsx"),
      "utf8"
    );
    const app = readFileSync(path.resolve("client/src/App.tsx"), "utf8");
    const nav = readFileSync(
      path.resolve("client/src/components/DashboardLayout.tsx"),
      "utf8"
    );
    const mappingService = readFileSync(
      path.resolve("server/crm/pipelineStageMappings.ts"),
      "utf8"
    );
    expect(server).toContain('mapping.category === "won"');
    expect(server).toContain('sourceStatus !== "won"');
    expect(mappingService).toContain('"limited_permissions"');
    expect(server).not.toMatch(/update\(|insert\(|delete\(/);
    expect(page).toContain("data-sales-tracker");
    expect(page).toContain("No CRM writes");
    expect(app).toContain('path="/sales-tracker"');
    expect(nav).toContain('label: "Sales Tracker"');
  });
});