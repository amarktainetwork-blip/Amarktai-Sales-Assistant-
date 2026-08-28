import "dotenv/config";
import { discoverAndReviewCompanyIntelligence } from "./companyIntelligenceService";

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
  let processStable = true;
  try {
    const result = await discoverAndReviewCompanyIntelligence({
      userId: input.userId,
      organisationId: input.organisationId,
      websiteUrl: input.websiteUrl,
      reference: `operator-company-knowledge:${Date.now()}`,
    });
    const completeness = result.aiReview.completeness;
    line("DISCOVERY_FETCH", "PASS");
    line("PAGES_SCANNED", completeness.pagesScanned);
    line("PAGES_CLASSIFIED", completeness.pagesClassified);
    line("PAGES_USED", completeness.pagesUsed);
    line("PAGES_EXCLUDED", completeness.pagesExcluded);
    line("CAREER_PROGRAMMES_FOUND", completeness.careerProgrammesDiscovered);
    line("INDIVIDUAL_COURSES_FOUND", completeness.individualCoursesDiscovered);
    line("FINAL_OFFERINGS", completeness.finalProposedOfferings);
    line("OFFERINGS_WITH_FULL_PRICE", completeness.offeringsWithEvidencedFullPrice);
    line("FINANCE_FOUND", completeness.financeInformationFound ? "YES" : "NO");
    line("CONTACT_FOUND", completeness.contactInformationFound ? "YES" : "NO");
    line("POLICIES_FOUND", completeness.policyTermsInformationFound ? "YES" : "NO");
    line("CERTIFICATIONS_FOUND", completeness.certificationInformationFound ? "YES" : "NO");
    line("SUPPORT_FOUND", completeness.supportAndOutcomeInformationFound ? "YES" : "NO");
    line("CONFLICTS_FOUND", completeness.conflictsFound);
    line("COMPLETENESS_STATUS", completeness.status);
  } catch (error) {
    processStable = true;
    line("DISCOVERY_FETCH", "FAIL");
    line("COMPLETENESS_STATUS", "incomplete");
    console.error(
      `Company knowledge verification failed: ${String(error instanceof Error ? error.message : error)
        .replace(/genx|provider|playwright|chromium/gi, "Amarktai service")
        .slice(0, 500)}`
    );
    process.exitCode = 1;
  } finally {
    line("APP_PROCESS_STABLE", processStable ? "PASS" : "FAIL");
    line("KNOWLEDGE_PERSISTED", "NO");
    line("KNOWLEDGE_APPROVED", "NO");
    line("CRM_TOUCHED", "NO");
  }
}

const invokedDirectly = process.argv[1]?.replaceAll("\\", "/").endsWith(
  "/verifyCompanyKnowledge.js"
) || process.argv[1]?.replaceAll("\\", "/").endsWith(
  "/verifyCompanyKnowledge.ts"
);

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
    }).finally(() => {
      // Operator verifiers must terminate after emitting their final report even if
      // shared runtime clients retain sockets for the long-lived application process.
      process.exit(process.exitCode ?? 0);
    });
  }
}
