import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../client/src/components/DashboardLayout.tsx", import.meta.url),
  "utf8"
);
const todaySource = readFileSync(
  new URL("./today.ts", import.meta.url),
  "utf8"
);

describe("workspace-wide CRM truth visibility", () => {
  it("warns on every sales page when the synchronized source truth is stale", () => {
    expect(source).toContain("truthAgeMs > 60_000");
    expect(source).toContain("CRM truth is stale.");
    expect(source).toContain("Screens may show work that has already");
    expect(source).toContain(
      "been completed until synchronization catches up."
    );
  });

  it("checks for new-lead notifications every 15 seconds", () => {
    const leadQuery = source.slice(
      source.indexOf("const newLeadAlerts"),
      source.indexOf("const inbox")
    );
    expect(leadQuery).toContain("refetchInterval: 15_000");
  });

  it("excludes retired CRM connections from authoritative workspace freshness", () => {
    const freshnessQuery = todaySource.slice(
      todaySource.indexOf("status: connectorSyncJobs.status"),
      todaySource.indexOf("message: inboundMessages")
    );
    expect(freshnessQuery).toContain(".innerJoin(");
    expect(freshnessQuery).toContain("connectedSystems.id");
    expect(freshnessQuery).toContain(
      'inArray(connectedSystems.status, ["ready", "limited_permissions"])'
    );
  });

  it("excludes retired connection owner mappings from active Today work", () => {
    const mappingsQuery = todaySource.slice(
      todaySource.indexOf("connectedSystemId: externalUserMappings"),
      todaySource.indexOf(".from(crmOpportunities)")
    );
    expect(mappingsQuery).toContain(".innerJoin(");
    expect(mappingsQuery).toContain("connectedSystems.id");
    expect(mappingsQuery).toContain('"ready", "limited_permissions"');
  });
});
