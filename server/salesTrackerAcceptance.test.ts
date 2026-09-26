import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  authoritativeOpportunityStatus,
  opportunityCountsAsWon,
} from "./salesTracker";

describe("read-only Sales Tracker", () => {
  it("uses the authoritative CRM opportunity status to reject lost records in a Won-labelled stage", () => {
    expect(authoritativeOpportunityStatus({ status: "won" })).toBe("won");
    expect(authoritativeOpportunityStatus({ status: "lost" })).toBe("lost");
    expect(authoritativeOpportunityStatus({ status: "unknown" })).toBeNull();
    expect(authoritativeOpportunityStatus({})).toBeNull();
  });

  it("treats explicit CRM Won status as authoritative even if the card was later moved to another stage", () => {
    expect(
      opportunityCountsAsWon({
        raw: { status: "won" },
        closeAt: new Date("2026-04-20T08:34:42.000Z"),
        mappedWonStage: false,
      })
    ).toBe(true);
    expect(
      opportunityCountsAsWon({
        raw: { status: "lost" },
        closeAt: new Date("2026-04-20T08:34:42.000Z"),
        mappedWonStage: true,
      })
    ).toBe(false);
    expect(
      opportunityCountsAsWon({
        raw: {},
        closeAt: null,
        mappedWonStage: true,
      })
    ).toBe(true);
    expect(
      opportunityCountsAsWon({
        raw: { status: "won" },
        closeAt: null,
        mappedWonStage: true,
      })
    ).toBe(false);
  });

  it("uses authoritative Won status first and stage mappings only as fallback", () => {
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
    expect(server).toContain('sourceStatus === "won"');
    expect(server).toContain("return input.mappedWonStage");
    expect(mappingService).toContain('"limited_permissions"');
    expect(server).not.toMatch(/update\(|insert\(|delete\(/);
    expect(page).toContain("data-sales-tracker");
    expect(page).toContain("No CRM writes");
    expect(app).toContain('path="/sales-tracker"');
    expect(nav).toContain('label: "Sales Tracker"');
  });
});