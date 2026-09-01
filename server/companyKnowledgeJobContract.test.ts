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

  it("keeps the API enqueue-only and runs durable scans in the dedicated worker process", () => {
    const jobs = read("./companyKnowledgeJobs.ts");
    const api = read("./_core/index.ts");
    const worker = read("./genie/healthWorker.ts");
    const commissioning = read("./crm/automaticCommissioning.ts");
    const ensureCommissioning = read("./crm/ensureCommissioning.ts");
    const compose = read("../deploy/webdock/docker-compose.yml");
    const enqueue = jobs.slice(
      jobs.indexOf("export async function startCompanyKnowledgeJob"),
      jobs.indexOf("export async function getLatestCompanyKnowledgeJob")
    );
    const retry = jobs.slice(
      jobs.indexOf("export async function retryCompanyKnowledgeJob"),
      jobs.indexOf("async function checkpoint")
    );
    expect(enqueue).not.toContain("scheduleCompanyKnowledgeJob");
    expect(enqueue).not.toContain("advanceCompanyKnowledgeJob");
    expect(retry).not.toContain("scheduleCompanyKnowledgeJob");
    expect(api).not.toContain("startCompanyKnowledgeWorker");
    expect(api).not.toContain("startAutomaticCommissioningWorker");
    expect(worker).toContain("startCompanyKnowledgeWorker()");
    expect(worker).toContain("startAutomaticCommissioningWorker()");
    expect(
      commissioning.slice(
        commissioning.indexOf(
          "export async function startAutomaticCommissioning"
        ),
        commissioning.indexOf(
          "export async function authoriseCommissioningSafeTest"
        )
      )
    ).not.toContain("scheduleAutomaticCommissioning");
    expect(ensureCommissioning).not.toContain("scheduleAutomaticCommissioning");
    expect(compose).toContain('COMPANY_KNOWLEDGE_WORKER_ENABLED: "true"');
  });

  it("bounds worker concurrency and retries transient failures with durable backoff", () => {
    const jobs = read("./companyKnowledgeJobs.ts");
    expect(jobs).toContain("COMPANY_KNOWLEDGE_WORKER_CONCURRENCY");
    expect(jobs).toContain("MAX_AUTO_ATTEMPTS");
    expect(jobs).toContain("RETRY_BASE_MS");
    expect(jobs).toContain('status: retrying ? "queued" : "failed"');
    expect(jobs).toContain("leaseExpiresAt: retrying");
    expect(jobs).toContain("workerConcurrency() - activeJobs.size");
    expect(jobs).toContain("lt(companyKnowledgeJobs.leaseExpiresAt, now)");
    expect(jobs).toContain('job.status === "queued"');
    expect(jobs).toContain('"Queued to retry"');
  });
});
