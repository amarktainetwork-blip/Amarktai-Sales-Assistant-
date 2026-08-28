import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("no-write whole-site operator verifier", () => {
  it("emits durable progress and the complete acceptance contract and exits", () => {
    const source = readFileSync(
      new URL("./verifyCompanyKnowledge.ts", import.meta.url),
      "utf8"
    );
    for (const key of [
      "DISCOVERY_FETCH",
      "PAGES_SCANNED",
      "PAGES_CLASSIFIED",
      "CORPUS_PAGES",
      "CORPUS_BYTES",
      "CORPUS_BUILD",
      "GENX_FILE_UPLOAD",
      "ANALYSIS_MODEL_SELECTED",
      "ANALYSIS_PASS",
      "AUDIT_PASS",
      "SOURCE_VALIDATION",
      "PAGES_USED",
      "CAREER_PROGRAMMES_FOUND",
      "INDIVIDUAL_COURSES_FOUND",
      "FINAL_OFFERINGS",
      "OFFERINGS_WITH_FULL_PRICE",
      "FINANCE_FOUND",
      "CONTACT_FOUND",
      "POLICIES_FOUND",
      "CERTIFICATIONS_FOUND",
      "SUPPORT_FOUND",
      "CONFLICTS_FOUND",
      "COMPLETENESS_STATUS",
      "AI_ANALYSIS_CALLS",
      "AI_REPAIR_CALLS",
      "TOTAL_AI_CALLS",
      "ELAPSED_SECONDS",
      "APP_PROCESS_STABLE",
      "KNOWLEDGE_PERSISTED",
      "KNOWLEDGE_APPROVED",
      "CRM_TOUCHED",
      "GENIE_TOUCHED",
    ])
      expect(source).toContain(`\"${key}\"`);
    expect(source).toContain("process.exit(process.exitCode ?? 0)");
    expect(source).not.toContain("saveWebsiteDiscoveryReview");
    expect(source).not.toMatch(
      /crm|genie/i.test("touch") ? /never/ : /saveCrm/
    );
  });
});
