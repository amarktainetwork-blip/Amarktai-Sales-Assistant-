import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isUnfilteredGenieBusinessSourceUrl } from "./genieCompanyScope";

const origin = "https://backend.leadconnectorhq.com/businesses/search";
const location = "verified-location";
const canonical = `${origin}?limit=20&skip=0&locationId=${location}&count=true`;

describe("complete, unfiltered Genie business snapshot guard", () => {
  it("accepts only the exact canonical unfiltered first page", () => {
    expect(isUnfilteredGenieBusinessSourceUrl(canonical, location)).toBe(true);
    expect(isUnfilteredGenieBusinessSourceUrl(
      `${origin}?count=true&locationId=${location}&skip=0&limit=20`, location
    )).toBe(true);
  });
  it.each([
    `${canonical}&search=company`,
    `${canonical}&filter=active`,
    `${canonical}&filters=%7B%22status%22%3A%22active%22%7D`,
    `${canonical}&query=company`,
    `${canonical}&locationId=other-location`,
    canonical.replace("skip=0", "skip=20"),
    canonical.replace("count=true", "count=false"),
    canonical.replace("limit=20", "limit=0"),
    canonical.replace("limit=20", "limit=500"),
    canonical.replace("locationId=verified-location", "locationId=other-location"),
    canonical.replace("backend.leadconnectorhq.com", "evil.invalid"),
  ])("rejects any filtered or untrusted source response", url => {
    expect(isUnfilteredGenieBusinessSourceUrl(url, location)).toBe(false);
  });
  it("requires complete-source reconciliation and cursor publication in one transaction", () => {
    const cli = readFileSync(
      new URL("../genie/proveCompanyReadsCli.ts", import.meta.url), "utf8"
    );
    const deletion = cli.indexOf("await tx.delete(crmCompanies).where(");
    const publish = cli.indexOf("await tx.insert(crmSyncCursors).values(");
    const proof = cli.indexOf("COMPLETE_GENUINE_COMPANY_SOURCE_PROOF_REQUIRED");
    expect(proof).toBeGreaterThan(0);
    expect(deletion).toBeGreaterThan(proof);
    expect(publish).toBeGreaterThan(deletion);
    expect(cli).toContain("eq(crmCompanies.organisationId,organisationId)");
    expect(cli).toContain("eq(crmCompanies.connectedSystemId,connectedSystemId)");
    expect(cli).toContain("notInArray(crmCompanies.externalId,normalized.map(row=>row.externalId))");
  });
});
