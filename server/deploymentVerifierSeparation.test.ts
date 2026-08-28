import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const platform = readFileSync(
  new URL("../deploy/webdock/verify-production.sh", import.meta.url),
  "utf8"
);
const clientAcceptance = readFileSync(
  new URL("../deploy/webdock/verify-client-acceptance.sh", import.meta.url),
  "utf8"
);
const strictVerifier = readFileSync(
  new URL("./verifyFeatures.ts", import.meta.url),
  "utf8"
);
const discoveryProbe = readFileSync(
  new URL("./verifyCompanyDiscovery.ts", import.meta.url),
  "utf8"
);
const knowledgeProbe = readFileSync(
  new URL("./verifyCompanyKnowledge.ts", import.meta.url),
  "utf8"
);

describe("deployment and client acceptance separation", () => {
  it("allows platform readiness before CRM commissioning without weakening strict acceptance", () => {
    expect(platform).toContain("PLATFORM_READY=PASS");
    expect(platform).toContain("CLIENT_ACCEPTANCE=PENDING");
    expect(platform).not.toContain("dist/verifyFeatures.js");
    expect(platform).toContain("await context.close()");
    expect(platform).not.toContain("browser.close()");
    expect(clientAcceptance).toContain("dist/verifyFeatures.js");
    expect(clientAcceptance).toContain("CLIENT_ACCEPTANCE=PASS");
    expect(strictVerifier).toContain("evaluateStrictClientAcceptance");
    expect(strictVerifier).toContain("process.exit(strict.passed ? 0 : 1)");
    expect(strictVerifier).toContain("live_call_audio_transcribed");
    expect(strictVerifier).toContain("assistant_response_generated");
    expect(strictVerifier).toContain("two_factor_verified");
    expect(strictVerifier).toContain('event: "feature_acceptance"');
  });

  it("keeps the website discovery probe diagnostic-only", () => {
    expect(discoveryProbe).toContain("discoverPublicWebsite(rawUrl)");
    expect(discoveryProbe).toContain('line("DISCOVERY_FETCH", "PASS")');
    expect(discoveryProbe).toContain('line("PAGES_COLLECTED"');
    expect(discoveryProbe).toContain('line("RENDERED_PAGES"');
    expect(discoveryProbe).toContain('line("RENDER_FALLBACKS"');
    expect(discoveryProbe).toContain('line("APP_PROCESS_STABLE", "PASS")');
    expect(discoveryProbe).not.toContain("saveWebsiteDiscoveryReview");
    expect(discoveryProbe).not.toContain("approveKnowledge");
    expect(discoveryProbe).not.toContain("Genie");
  });

  it("keeps the full knowledge verifier review-only and separate from CRM and Genie", () => {
    expect(knowledgeProbe).toContain("discoverAndReviewCompanyIntelligence");
    for (const field of [
      "PAGES_SCANNED",
      "PAGES_CLASSIFIED",
      "PAGES_USED",
      "PAGES_EXCLUDED",
      "CAREER_PROGRAMMES_FOUND",
      "INDIVIDUAL_COURSES_FOUND",
      "CONFLICTS_FOUND",
      "COMPLETENESS_STATUS",
      "KNOWLEDGE_PERSISTED",
      "KNOWLEDGE_APPROVED",
      "CRM_TOUCHED",
    ]) expect(knowledgeProbe).toContain(field);
    expect(knowledgeProbe).not.toContain("saveWebsiteDiscoveryReview");
    expect(knowledgeProbe).not.toContain("confirmWebsiteDiscovery");
    expect(knowledgeProbe).not.toContain("connectedSystems");
    expect(knowledgeProbe).not.toContain("genie/");
  });
});
