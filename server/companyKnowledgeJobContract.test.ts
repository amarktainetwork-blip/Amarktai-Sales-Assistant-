import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

describe("durable company knowledge job contract", () => {
  it("scopes status and retry operations to user, organisation and company profile", () => {
    const jobs = read("./companyKnowledgeJobs.ts");
    const statusScope = jobs.slice(
      jobs.indexOf("export async function getLatestCompanyKnowledgeJob"),
      jobs.indexOf("export async function retryCompanyKnowledgeJob")
    );
    const retryScope = jobs.slice(
      jobs.indexOf("export async function retryCompanyKnowledgeJob"),
      jobs.indexOf("async function advanceCompanyKnowledgeJob")
    );
    for (const scope of [statusScope, retryScope]) {
      expect(scope).toContain("companyKnowledgeJobs.userId");
      expect(scope).toContain("companyKnowledgeJobs.organisationId");
      expect(scope).toContain("companyKnowledgeJobs.companyProfileId");
    }
  });

  it("retains history and checkpoints without destructive migration or auto approval", () => {
    const schema = read("../drizzle/schema.ts");
    const migration = read("../drizzle/0028_spicy_warpath.sql");
    const jobs = read("./companyKnowledgeJobs.ts");
    expect(schema).toContain('"companyKnowledgeJobs"');
    expect(schema).toContain("discoverySnapshot");
    expect(schema).toContain("mapResults");
    expect(migration).toContain("CREATE TABLE `companyKnowledgeJobs`");
    expect(migration).not.toMatch(/DROP\s+(?:TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM/i);
    expect(jobs).toContain("knowledgePersisted: false");
    expect(jobs).toContain("knowledgeApproved: false");
    expect(jobs).not.toContain("confirmWebsiteDiscovery(");
  });
});
