import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPersonalEmailStyleLearningPrompt,
  isAmarktaiGeneratedSentMessage,
  redactStyleEvidence,
  rewritePreservesProtectedLiterals,
  stripQuotedEmailHistory,
} from "./personalWorkLearning";

describe("personal work self-learning", () => {
  it("keeps company website relearning explicitly manager triggered", () => {
    const healthWorker = readFileSync(
      path.resolve("server/genie/healthWorker.ts"),
      "utf8"
    );
    const knowledge = readFileSync(
      path.resolve("client/src/pages/Knowledge.tsx"),
      "utf8"
    );
    expect(healthWorker).not.toContain("CompanyKnowledgeAutoRefresh");
    expect(healthWorker).not.toContain("companyKnowledgeRefresh");
    expect(knowledge).toContain("Refresh website knowledge");
    expect(knowledge).toContain("management.data?.elevated");
  });

  it("does not mistake quoted customer history for the user's writing", () => {
    const body = [
      "Hi Sam,",
      "Thanks for the update. I will call you tomorrow.",
      "Kind regards,",
      "Amelia",
      "",
      "-----Original Message-----",
      "From: Customer <customer@example.com>",
      "This wording belongs to the customer, not Amelia.",
    ].join("\n");
    const result = stripQuotedEmailHistory(body);
    expect(result).toContain("I will call you tomorrow");
    expect(result).not.toContain("belongs to the customer");
  });

  it("redacts common identifiers and secrets before style extraction", () => {
    const result = redactStyleEvidence(
      "Email me at amelia@example.com, call +27 82 123 4567, open https://example.com and use OTP 918273."
    );
    expect(result).not.toContain("amelia@example.com");
    expect(result).not.toContain("+27 82 123 4567");
    expect(result).not.toContain("https://example.com");
    expect(result).not.toContain("918273");
    expect(result).toContain("[email]");
    expect(result).toContain("[link]");
    expect(result).toContain("[redacted]");
  });

  it("excludes Amarktai-generated sent messages from the personal style evidence", () => {
    expect(
      isAmarktaiGeneratedSentMessage({
        id: "1",
        internetMessageHeaders: [
          { name: "X-Amarktai-Review-Reference", value: "review-1" },
        ],
      })
    ).toBe(true);
    expect(
      isAmarktaiGeneratedSentMessage({
        id: "2",
        internetMessageHeaders: [{ name: "X-Custom", value: "ok" }],
      })
    ).toBe(false);
  });

  it("requires repeated evidence before calling a writing structure a template", () => {
    const prompt = buildPersonalEmailStyleLearningPrompt([
      "SUBJECT: Hello\nBODY:\nThanks for your time.",
      "SUBJECT: Follow up\nBODY:\nGood speaking with you.",
    ]);
    expect(prompt).toContain("at least two separate samples");
    expect(prompt).toContain("Do not infer protected/sensitive personal traits");
    expect(prompt).toContain("recurring template structures");
  });

  it("rejects style rewrites that alter protected factual literals", () => {
    const original =
      "Please review R 1,250 by 12/09/2026. Details: https://example.com/a and quote 12345.";
    expect(
      rewritePreservesProtectedLiterals(
        original,
        "Please review R 1,250 by 12/09/2026. Details: https://example.com/a and quote 12345."
      )
    ).toBe(true);
    expect(
      rewritePreservesProtectedLiterals(
        original,
        "Please review R 1,500 by 12/09/2026. Details: https://example.com/a and quote 12345."
      )
    ).toBe(false);
    expect(
      rewritePreservesProtectedLiterals(
        original,
        "Please review R 1,250 by 13/09/2026. Details: https://example.com/a and quote 12345."
      )
    ).toBe(false);
  });
});
