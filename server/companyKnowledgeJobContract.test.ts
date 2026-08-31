import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

describe("durable whole-site company knowledge job contract", () => {
  it("scopes shared company status and retry operations to organisation and company profile", () => {
    const jobs = read("./companyKnowledgeJobs.ts");
    const statusScope = jobs.slice(
      jobs.indexOf("export async function getLatestCompanyKnowledgeJob"),
      jobs.indexOf("export async function retryCompanyKnowledgeJob")
    );
    const retryScope = jobs.slice(
      jobs.indexOf("export async function retryCompanyKnowledgeJob"),
      jobs.indexOf("async function checkpoint")
    );
    for (const scope of [statusScope, retryScope]) {
      expect(scope).toContain("companyKnowledgeJobs.organisationId");
      expect(scope).toContain("companyKnowledgeJobs.companyProfileId");
      expect(scope).not.toContain(
        "eq(companyKnowledgeJobs.userId, input.userId)"
      );
    }
  });

  it("checkpoints corpus, analyst, critic and temporary-resource state without auto approval", () => {
    const schema = read("../drizzle/schema.ts");
    const jobs = read("./companyKnowledgeJobs.ts");
    for (const field of [
      "corpusSnapshot",
      "corpusHash",
      "sourceHashes",
      "analysisDraft",
      "auditDraft",
      "validatedPack",
      "temporaryResources",
      "analysisCalls",
      "auditCalls",
      "normalizationEvents",
      "repairCalls",
    ])
      expect(schema).toContain(field);
    expect(jobs).toContain("knowledgePersisted: false");
    expect(jobs).toContain("knowledgeApproved: false");
    expect(jobs).toContain("crmTouched: false");
    expect(jobs).toContain("genieTouched: false");
    expect(jobs).not.toContain("confirmWebsiteDiscovery(");
  });

  it("claims a queued or expired job atomically before billable work", () => {
    const jobs = read("./companyKnowledgeJobs.ts");
    const claim = jobs.slice(
      jobs.indexOf("async function claimCompanyKnowledgeJob"),
      jobs.indexOf("function parseCheckpoint")
    );
    const advance = jobs.slice(
      jobs.indexOf("async function advanceCompanyKnowledgeJob"),
      jobs.indexOf("export async function resumeCompanyKnowledgeJobs")
    );
    expect(claim).toContain('eq(companyKnowledgeJobs.status, "queued")');
    expect(claim).toContain('eq(companyKnowledgeJobs.status, "running")');
    expect(claim).toContain("companyKnowledgeJobs.leaseExpiresAt");
    expect(claim).toContain("affectedRows");
    expect(advance).toContain(
      "if (!(await claimCompanyKnowledgeJob(jobId))) return"
    );
  });

  it("resumes successful expensive passes and cleans abandoned resources", () => {
    const jobs = read("./companyKnowledgeJobs.ts");
    expect(jobs).toMatch(/parseCheckpoint\(\s*job\.corpusSnapshot/);
    expect(jobs).toMatch(/parseCheckpoint\(\s*job\.analysisDraft/);
    expect(jobs).toMatch(/parseCheckpoint\(\s*job\.auditDraft/);
    expect(jobs).toContain("cleanupAbandonedResources(job)");
    expect(jobs).toContain(
      "new GenxCompanyLearningClient().cleanup(resources)"
    );
  });

  it("keeps complete retained bodies private and strips them from review output", () => {
    const discovery = read("./companyDiscovery.ts");
    const intelligence = read("./companyIntelligenceService.ts");
    expect(discovery).toContain("text: page.text");
    expect(intelligence).toContain(
      'page.text ?? textByUrl.get(page.url) ?? ""'
    );
    expect(intelligence).toContain(
      "discovery.pages.map(({ text: _text, ...page }) => page)"
    );
    expect(intelligence).toContain("pages: safePages");
  });

  it("uses the same bounded canonical runtime for verifier and review-only UI jobs", () => {
    const jobs = read("./companyKnowledgeJobs.ts");
    const intelligence = read("./companyIntelligenceService.ts");
    const verifier = read("./verifyCompanyKnowledge.ts");
    for (const source of [jobs, intelligence, verifier])
      expect(source).toContain('from "./companyKnowledgePartialBatchRuntime"');
    expect(intelligence).not.toContain('from "./companyKnowledgeSynthesis"');
    expect(jobs).not.toContain("confirmWebsiteDiscovery(");
    expect(jobs).toContain("knowledgeApproved: false");
    expect(jobs).toContain("crmTouched: false");
    expect(jobs).toContain("genieTouched: false");
  });
});
