import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { agentRuntimeStatus } from "./agentCatalog";
import {
  retainedPagesForCompanyReview,
  reviewStoredCompanyIntelligence,
} from "./companyIntelligenceService";

const ready = {
  databaseReady: true,
  genxReady: true,
  crmReadReady: true,
  crmRouteReady: true,
  communicationsReady: true,
  voiceReady: true,
};

describe("final launch acceptance safeguards", () => {
  it("derives model and CRM agent readiness from live dependencies", () => {
    expect(
      agentRuntimeStatus("company_intelligence_review", {
        ...ready,
        genxReady: false,
      })
    ).toBe("NEEDS_CONNECTION");
    expect(
      agentRuntimeStatus("crm_context", {
        ...ready,
        crmReadReady: false,
        crmRouteReady: false,
      })
    ).toBe("NEEDS_CONNECTION");
    expect(agentRuntimeStatus("sales_intelligence", ready)).toBe("READY");
    expect(
      agentRuntimeStatus("sales_intelligence", { ...ready, genxReady: false })
    ).toBe("NEEDS_CONNECTION");
    expect(agentRuntimeStatus("objection_handler", ready)).toBe("READY");
    expect(agentRuntimeStatus("recommendation_agent", ready)).toBe("READY");
    expect(agentRuntimeStatus("pipeline_planner", ready)).toBe("READY");
    expect(agentRuntimeStatus("supervisor", ready)).toBe("READY");
  });

  it("reconstructs review input only from retained raw page evidence", () => {
    const pages = retainedPagesForCompanyReview(
      "[https://example.test/pricing]\nFirst-party price evidence",
      [
        {
          url: "https://example.test/pricing",
          title: "Pricing",
          fetchedAt: "2026-08-26T00:00:00.000Z",
        },
      ]
    );
    expect(pages).toEqual([
      {
        url: "https://example.test/pricing",
        title: "Pricing",
        fetchedAt: "2026-08-26T00:00:00.000Z",
        text: "First-party price evidence",
      },
    ]);
  });

  it("fails closed when a retry has no retained raw pages", async () => {
    await expect(
      reviewStoredCompanyIntelligence({
        userId: 1,
        organisationId: 1,
        discoveryId: 1,
        pages: [],
      })
    ).rejects.toThrow("Retained raw page evidence is unavailable");
  });

  it("keeps exactly four user-facing onboarding stages and removes the dead automation render path", () => {
    const source = readFileSync(
      new URL("../client/src/pages/Onboarding.tsx", import.meta.url),
      "utf8"
    );
    expect(source).toContain(
      'const labels = ["Business", "Learn", "CRM", "Assistant"]'
    );
    expect(source).not.toContain("{false && (");
    expect(source).not.toContain("Choose the first safe automation rule");
    expect(source).not.toContain("stored server evidence");
  });
});
