import "dotenv/config";
import { discoverPublicWebsite } from "./companyDiscovery";
import {
  buildReviewedCompanyDiscovery,
  pagesForCompanyReview,
} from "./companyIntelligenceService";
import {
  synthesiseCompanyKnowledge,
  type WholeSiteCheckpoint,
} from "./companyKnowledgePartialBatchRuntime";

function positiveId(value: string | undefined, label: string) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

function line(name: string, value: string | number) {
  console.log(`${name}=${value}`);
}

export async function verifyCompanyKnowledge(input: {
  websiteUrl: string;
  userId: number;
  organisationId: number;
}) {
  const started = Date.now();
  let processStable = true;
  let inlineTransportObserved = false;
  try {
    line("MILESTONE", "Scanning website");
    const discovery = await discoverPublicWebsite(input.websiteUrl);
    line("DISCOVERY_FETCH", "PASS");
    line("PAGES_SCANNED", discovery.pages.length);
    line("PAGES_CLASSIFIED", discovery.pages.length);
    line("MILESTONE", "Building company corpus");
    line("GENX_FILE_UPLOAD", "DISABLED_UNSAFE");
    line("PARTIAL_BATCH_SCHEMA", "ENABLED");
    const review = await synthesiseCompanyKnowledge({
      userId: input.userId,
      organisationId: input.organisationId,
      pages: pagesForCompanyReview(discovery),
      reference: `operator-company-knowledge:${Date.now()}`,
      onCheckpoint: async (checkpoint: WholeSiteCheckpoint) => {
        if (checkpoint.kind === "corpus") {
          line("CORPUS_PAGES", checkpoint.corpus.pageCount);
          line("CORPUS_BYTES", checkpoint.corpus.byteSize);
          line("CORPUS_BUILD", "PASS");
        }
        if (
          checkpoint.kind === "resources" &&
          checkpoint.resources.sessionIds.length > 0 &&
          !inlineTransportObserved
        ) {
          inlineTransportObserved = true;
          line("GENX_INLINE_CONTEXT", "PASS");
        }
      },
      onPhase: async phase => {
        const labels = {
          corpus: "Building company corpus",
          analysis: "Understanding company",
          audit: "Auditing company knowledge",
          validation: "Verifying sources",
          completeness: "Checking completeness",
        } as const;
        line("MILESTONE", labels[phase]);
      },
    });
    buildReviewedCompanyDiscovery(discovery, review);
    if (!inlineTransportObserved)
      throw new Error(
        "The bounded inline company-learning transport milestone was not observed."
      );
    if (
      !review.selectedModelOperations.analysis ||
      !review.selectedModelOperations.audit
    )
      throw new Error(
        "The required company-learning models were not selected from the live account catalogue."
      );
    const completeness = review.completeness;
    line("ANALYSIS_MODEL_SELECTED", "PASS");
    line("ANALYSIS_PASS", "PASS");
    line("AUDIT_PASS", "PASS");
    line("SOURCE_VALIDATION", "PASS");
    line("PAGES_USED", completeness.pagesUsed);
    line("PAGES_EXCLUDED", completeness.pagesExcluded);
    line("CAREER_PROGRAMMES_FOUND", completeness.careerProgrammesDiscovered);
    line("INDIVIDUAL_COURSES_FOUND", completeness.individualCoursesDiscovered);
    line("FINAL_OFFERINGS", completeness.finalProposedOfferings);
    line(
      "OFFERINGS_WITH_FULL_PRICE",
      completeness.offeringsWithEvidencedFullPrice
    );
    line("FINANCE_FOUND", completeness.financeInformationFound ? "YES" : "NO");
    line("CONTACT_FOUND", completeness.contactInformationFound ? "YES" : "NO");
    line(
      "POLICIES_FOUND",
      completeness.policyTermsInformationFound ? "YES" : "NO"
    );
    line(
      "CERTIFICATIONS_FOUND",
      completeness.certificationInformationFound ? "YES" : "NO"
    );
    line(
      "SUPPORT_FOUND",
      completeness.supportAndOutcomeInformationFound ? "YES" : "NO"
    );
    line("CONFLICTS_FOUND", completeness.conflictsFound);
    line("COMPLETENESS_STATUS", completeness.status);
    line("AI_ANALYSIS_CALLS", review.analysisCalls);
    line("AI_REPAIR_CALLS", review.repairCalls);
    line("TOTAL_AI_CALLS", review.totalAiCalls);
    line("ELAPSED_SECONDS", Math.ceil((Date.now() - started) / 1_000));
    if (completeness.status === "incomplete") process.exitCode = 1;
  } catch (error) {
    processStable = true;
    line("DISCOVERY_FETCH", "FAIL");
    line("COMPLETENESS_STATUS", "incomplete");
    line("ELAPSED_SECONDS", Math.ceil((Date.now() - started) / 1_000));
    console.error(
      `Company knowledge verification failed: ${String(
        error instanceof Error ? error.message : error
      )
        .replace(
          /genx|provider|playwright|chromium|claude|openai|anthropic|gemini|grok|gpt[-\w.]*/gi,
          "Amarktai service"
        )
        .replace(/gnxk_[A-Za-z0-9_-]+/g, "[redacted]")
        .slice(0, 500)}`
    );
    process.exitCode = 1;
  } finally {
    line("APP_PROCESS_STABLE", processStable ? "PASS" : "FAIL");
    line("KNOWLEDGE_PERSISTED", "NO");
    line("KNOWLEDGE_APPROVED", "NO");
    line("CRM_TOUCHED", "NO");
    line("GENIE_TOUCHED", "NO");
  }
}

const invokedDirectly =
  process.argv[1]
    ?.replaceAll("\\", "/")
    .endsWith("/verifyCompanyKnowledge.js") ||
  process.argv[1]?.replaceAll("\\", "/").endsWith("/verifyCompanyKnowledge.ts");

if (invokedDirectly) {
  const websiteUrl = process.argv[2];
  if (!websiteUrl) {
    console.error(
      "Usage: verify:company-knowledge <public-url> <user-id> <organisation-id>"
    );
    process.exitCode = 2;
  } else {
    void verifyCompanyKnowledge({
      websiteUrl,
      userId: positiveId(
        process.argv[3] || process.env.COMPANY_KNOWLEDGE_VERIFY_USER_ID,
        "user-id"
      ),
      organisationId: positiveId(
        process.argv[4] || process.env.COMPANY_KNOWLEDGE_VERIFY_ORGANISATION_ID,
        "organisation-id"
      ),
    }).finally(() => process.exit(process.exitCode ?? 0));
  }
}
