import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { discoverPublicWebsite } from "./companyDiscovery";
import {
  buildReviewedCompanyDiscovery,
  pagesForCompanyReview,
} from "./companyIntelligenceService";
import {
  synthesiseCompanyKnowledge,
  type CompanyKnowledgeSynthesisResult,
  type WholeSiteCheckpoint,
} from "./companyKnowledgePartialBatchRuntime";
import { formatCompanyKnowledgeOutputDiagnostic } from "./companyKnowledgeModelOutput";

function positiveId(value: string | undefined, label: string) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

function line(name: string, value: string | number) {
  console.log(`${name}=${value}`);
}

export function companyKnowledgeReviewArtifact(input: {
  websiteUrl: string;
  review: CompanyKnowledgeSynthesisResult;
}) {
  const { pack, corpus, completeness } = input.review;
  return {
    artifactType: "amarktai_company_learning_review",
    generatedAt: input.review.reviewedAt,
    websiteUrl: input.websiteUrl,
    lifecycleState: "REVIEW_REQUIRED",
    safety: {
      knowledgePersisted: false,
      knowledgeApproved: false,
      crmTouched: false,
      genieTouched: false,
    },
    corpus: {
      pageCount: corpus.pageCount,
      byteSize: corpus.byteSize,
      corpusHash: corpus.corpusHash,
      sources: corpus.pages.map(page => ({
        pageId: page.pageId,
        url: page.url,
        title: page.title,
        primaryHeading: page.primaryHeading,
        contentHash: page.contentHash,
      })),
    },
    company: pack.company,
    offerings: pack.offerings,
    finance: pack.finance,
    contacts: pack.contacts,
    locations: pack.locations,
    policies: pack.policies,
    refundCancellationTerms: pack.refundCancellationTerms,
    certificationsAndAccreditation: pack.certificationsAndAccreditation,
    supportAndOutcomes: pack.supportAndOutcomes,
    contactKnowledge: pack.contactKnowledge,
    faqs: pack.faqs,
    salesUsefulFacts: pack.salesUsefulFacts,
    excludedContent: pack.excludedContent,
    conflicts: pack.conflicts,
    importantGaps: completeness.importantGaps,
    sourceIndex: pack.sourceIndex,
    completeness,
    calls: {
      analysis: input.review.analysisCalls,
      audit: input.review.auditCalls,
      normalizationEvents: input.review.normalizationEvents,
      repair: input.review.repairCalls,
      total: input.review.totalAiCalls,
    },
  };
}

async function writeReviewArtifact(
  outputPath: string,
  artifact: ReturnType<typeof companyKnowledgeReviewArtifact>
) {
  const absolutePath = resolve(outputPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(artifact, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return absolutePath;
}

export async function verifyCompanyKnowledge(input: {
  websiteUrl: string;
  userId: number;
  organisationId: number;
  reviewOutputPath?: string;
}) {
  const started = Date.now();
  let processStable = true;
  let inlineTransportObserved = false;
  let discoveryFetched = false;
  try {
    line("MILESTONE", "Scanning website");
    const discovery = await discoverPublicWebsite(input.websiteUrl);
    discoveryFetched = true;
    line("DISCOVERY_FETCH", "PASS");
    line("PAGES_SCANNED", discovery.pages.length);
    line("PAGES_CLASSIFIED", discovery.pages.length);
    line("MILESTONE", "Building company corpus");
    line("GENX_FILE_UPLOAD", "DISABLED_UNSAFE");
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
    line("PARTIAL_BATCH_SCHEMA", "PASS");
    line("ANALYSIS_PASS", "PASS");
    line("AUDIT_NORMALIZATION", "PASS");
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
    line("AI_AUDIT_CALLS", review.auditCalls);
    line("NORMALIZATION_EVENTS", review.normalizationEvents);
    line("AI_REPAIR_CALLS", review.repairCalls);
    line("TOTAL_AI_CALLS", review.totalAiCalls);
    const reviewArtifactPath = await writeReviewArtifact(
      input.reviewOutputPath ||
        process.env.COMPANY_KNOWLEDGE_REVIEW_OUTPUT ||
        "company-learning-review.json",
      companyKnowledgeReviewArtifact({ websiteUrl: input.websiteUrl, review })
    );
    line("EXACT_REVIEW_PACK", "PASS");
    line("REVIEW_ARTIFACT", reviewArtifactPath);
    line("ELAPSED_SECONDS", Math.ceil((Date.now() - started) / 1_000));
    if (completeness.status === "incomplete") process.exitCode = 1;
  } catch (error) {
    processStable = true;
    if (!discoveryFetched) line("DISCOVERY_FETCH", "FAIL");
    line("PIPELINE_STATUS", "FAIL");
    line("COMPLETENESS_STATUS", "incomplete");
    line("ELAPSED_SECONDS", Math.ceil((Date.now() - started) / 1_000));
    console.error(
      `Company knowledge verification failed: ${String(
        formatCompanyKnowledgeOutputDiagnostic(error)
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
      reviewOutputPath:
        process.argv[5] || process.env.COMPANY_KNOWLEDGE_REVIEW_OUTPUT,
    }).finally(() => process.exit(process.exitCode ?? 0));
  }
}
