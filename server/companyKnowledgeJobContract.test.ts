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

  it("claims a queued or expired job atomically before billable work", () => {
    const jobs = read("./companyKnowledgeJobs.ts");
    const claim = jobs.slice(
      jobs.indexOf("async function claimCompanyKnowledgeJob"),
      jobs.indexOf("function resumableMapResultsForRetry")
    );
    const advance = jobs.slice(
      jobs.indexOf("async function advanceCompanyKnowledgeJob"),
      jobs.indexOf("export async function resumeCompanyKnowledgeJobs")
    );
    expect(claim).toContain('eq(companyKnowledgeJobs.status, "queued")');
    expect(claim).toContain('eq(companyKnowledgeJobs.status, "running")');
    expect(claim).toContain("companyKnowledgeJobs.leaseExpiresAt");
    expect(claim).toContain("affectedRows");
    expect(claim).toContain("=== 1");
    expect(advance).toContain("const claimed = await claimCompanyKnowledgeJob(jobId)");
    expect(advance).toContain("if (!claimed) return");
  });

  it("does not reschedule a running job while its database lease is live", () => {
    const jobs = read("./companyKnowledgeJobs.ts");
    const start = jobs.slice(
      jobs.indexOf("export async function startCompanyKnowledgeJob"),
      jobs.indexOf("export async function getLatestCompanyKnowledgeJob")
    );
    expect(start).toContain("const leaseExpired");
    expect(start).toContain('active.status === "queued" || leaseExpired');
  });

  it("invalidates completed likely-offering maps that caused completeness gaps", () => {
    const jobs = read("./companyKnowledgeJobs.ts");
    const recovery = jobs.slice(
      jobs.indexOf("function resumableMapResultsForRetry"),
      jobs.indexOf("export function scheduleCompanyKnowledgeJob")
    );
    const retry = jobs.slice(
      jobs.indexOf("export async function retryCompanyKnowledgeJob"),
      jobs.indexOf("async function advanceCompanyKnowledgeJob")
    );
    expect(recovery).toContain("likelyOfferingUrls");
    expect(recovery).toContain('item.classification === "company_offering"');
    expect(recovery).toContain("item.sourceUrls.includes(result.pageUrl)");
    expect(retry).toContain("const resumeMapResults = resumableMapResultsForRetry(job)");
    expect(retry).toContain("mapResults: resumeMapResults");
  });

  it("keeps complete retained page bodies in the private job snapshot but strips them from review output", () => {
    const discovery = read("./companyDiscovery.ts");
    const intelligence = read("./companyIntelligenceService.ts");
    expect(discovery).toContain("text: page.text");
    expect(intelligence).toContain("page.text ?? textByUrl.get(page.url) ?? \"\"");
    expect(intelligence).toContain("const safePages = discovery.pages.map(({ text: _retainedText, ...page }) => page)");
    expect(intelligence).toContain("pages: safePages");
  });
});
