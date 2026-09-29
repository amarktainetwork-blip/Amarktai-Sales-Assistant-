import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../client/src/components/DashboardLayout.tsx", import.meta.url),
  "utf8"
);

describe("workspace-wide CRM truth visibility", () => {
  it("warns on every sales page when the synchronized source truth is stale", () => {
    expect(source).toContain("truthAgeMs > 90_000");
    expect(source).toContain("CRM truth is stale.");
    expect(source).toContain("Screens may show work Amelia has already");
  });

  it("checks for new-lead notifications every 15 seconds", () => {
    const leadQuery = source.slice(
      source.indexOf("const newLeadAlerts"),
      source.indexOf("const inbox")
    );
    expect(leadQuery).toContain("refetchInterval: 15_000");
  });
});
