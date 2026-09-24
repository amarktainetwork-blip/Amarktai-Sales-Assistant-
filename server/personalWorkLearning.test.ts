import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPersonalEmailStyleLearningPrompt,
  buildSalesWorkingProfilePrompt,
  crmActivityStyleEvidence,
  crmActivityWorkingStyleEvidence,
  isAmarktaiGeneratedSentMessage,
  redactStyleEvidence,
  rewritePreservesProtectedLiterals,
  shouldApplyPersonalStyleToDraft,
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

  it("redacts greetings and commercial literals from style evidence", () => {
    const result = redactStyleEvidence(
      "Hi Kamil, the course is £1,857 with a 25% option. Call me on +44 800 123 4567."
    );
    expect(result).toContain("Hi [name]");
    expect(result).toContain("[amount]");
    expect(result).toContain("[percentage]");
    expect(result).not.toContain("Kamil");
    expect(result).not.toContain("1,857");
    expect(result).not.toContain("25%");
  });

  it("accepts only outbound CRM email evidence authored by the exact mapped salesperson", () => {
    const activity = {
      externalId: "message-1",
      occurredAt: new Date("2026-09-21T15:00:00Z"),
      body: "Hi Sam, thanks for speaking with me today. I will follow up tomorrow.",
      raw: {
        direction: "outbound",
        userExternalId: "amelia-owner",
        senderReference: "Amelia <amelia@example.com>",
        subject: "Follow up",
      },
    };
    expect(
      crmActivityStyleEvidence(activity, {
        externalUserId: "amelia-owner",
        email: "amelia@example.com",
      })?.sample
    ).toContain("Hi [name]");
    expect(
      crmActivityStyleEvidence(
        {
          ...activity,
          raw: {
            ...activity.raw,
            userExternalId: "someone-else",
            senderReference: "Other <other@example.com>",
          },
        },
        {
          externalUserId: "amelia-owner",
          email: "amelia@example.com",
        }
      )
    ).toBeUndefined();
    expect(
      crmActivityStyleEvidence(
        {
          ...activity,
          raw: { ...activity.raw, direction: "inbound" },
        },
        {
          externalUserId: "amelia-owner",
          email: "amelia@example.com",
        }
      )
    ).toBeUndefined();
  });

  it("learns working patterns only from positively attributed salesperson CRM evidence", () => {
    const note = {
      externalId: "note-1",
      activityType: "note",
      occurredAt: new Date("2026-09-24T12:00:00Z"),
      body:
        "Follow-up completed. Candidate asked for more time. Next action: follow up tomorrow.",
      raw: {
        sourceKind: "contact_note",
        authorExternalId: "amelia-owner",
      },
    };
    expect(
      crmActivityWorkingStyleEvidence(note, {
        externalUserId: "amelia-owner",
      })?.sample
    ).toContain("Next action: follow up tomorrow");
    expect(
      crmActivityWorkingStyleEvidence(
        {
          ...note,
          raw: { ...note.raw, authorExternalId: "other-user" },
        },
        { externalUserId: "amelia-owner" }
      )
    ).toBeUndefined();
    expect(
      crmActivityWorkingStyleEvidence(
        {
          ...note,
          activityType: "sms",
          raw: {
            direction: "inbound",
            userExternalId: "amelia-owner",
          },
        },
        { externalUserId: "amelia-owner" }
      )
    ).toBeUndefined();
    expect(
      crmActivityWorkingStyleEvidence(
        {
          ...note,
          raw: {
            sourceKind: "amarktai_generated",
            authorExternalId: "amelia-owner",
          },
        },
        { externalUserId: "amelia-owner" }
      )
    ).toBeUndefined();
  });

  it("keeps learned working patterns advisory rather than policy or permission", () => {
    const prompt = buildSalesWorkingProfilePrompt([
      "TYPE: NOTE\nCONTENT:\nFollow-up completed. Next action recorded.",
      "TYPE: SMS\nCONTENT:\nI will check back tomorrow.",
    ]);
    expect(prompt).toContain("never authorises a CRM write");
    expect(prompt).toContain("not company policy");
    expect(prompt).toContain("patterns actually supported across multiple records");
    expect(prompt).toContain("Do not copy customer names");
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
    expect(prompt).toContain(
      "Do not infer protected/sensitive personal traits"
    );
    expect(prompt).toContain("recurring template structures");
  });

  it("reuses learned style for delegated and read-only CRM review drafts only", () => {
    expect(
      shouldApplyPersonalStyleToDraft({
        actionType: "send_email",
        payload: {
          body: "A grounded review draft",
          crmRoute: { provider: "microsoft_delegated" },
        },
      })
    ).toBe(true);
    expect(
      shouldApplyPersonalStyleToDraft({
        actionType: "send_email",
        payload: { body: "A grounded review draft", draftOnly: true },
      })
    ).toBe(true);
    expect(
      shouldApplyPersonalStyleToDraft({
        actionType: "send_email",
        payload: {
          body: "Already styled",
          draftOnly: true,
          personalStyleApplied: true,
        },
      })
    ).toBe(false);
    expect(
      shouldApplyPersonalStyleToDraft({
        actionType: "update_crm",
        payload: { body: "Not a communication", draftOnly: true },
      })
    ).toBe(false);
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
