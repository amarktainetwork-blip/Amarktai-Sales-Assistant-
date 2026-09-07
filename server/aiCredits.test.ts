import { describe, expect, it } from "vitest";
import {
  aiUsageMetadata,
  assessAiCreditDebit,
  classifyAiPurpose,
  type CreditLedgerMetadata,
} from "./aiCredits";

const allowance: CreditLedgerMetadata = {
  creditsDelta: 100,
  transactionType: "allowance",
  period: "2026-08",
};

describe("AI credit debit invariants", () => {
  it("accepts a debit only when the locked ledger has enough balance", () => {
    expect(
      assessAiCreditDebit(
        [
          allowance,
          { creditsDelta: -20, transactionType: "usage", reference: "prior" },
        ],
        70,
        "next"
      )
    ).toEqual({ idempotent: false, balance: 80 });
    expect(() =>
      assessAiCreditDebit(
        [
          allowance,
          { creditsDelta: -20, transactionType: "usage", reference: "prior" },
        ],
        81,
        "next"
      )
    ).toThrow("80 AI Credits");
  });

  it("treats a repeated usage reference as idempotent rather than charging twice", () => {
    expect(
      assessAiCreditDebit(
        [
          allowance,
          {
            creditsDelta: -15,
            transactionType: "usage",
            reference: "provider-call-17",
          },
        ],
        15,
        "provider-call-17"
      )
    ).toEqual({ idempotent: true, balance: 85 });
  });

  it("records bounded provider and purpose telemetry, including zero-credit calls", () => {
    expect(classifyAiPurpose("crm_automatic_commissioning")).toBe(
      "crm_commissioning"
    );
    expect(classifyAiPurpose("assistant_email_draft")).toBe(
      "communication_draft"
    );
    expect(
      aiUsageMetadata({
        credits: 0,
        feature: "assistant_email_draft",
        model: "test-model",
        providerUsage: { totalTokens: 12 },
        reference: "request-7",
        billingExempt: false,
      })
    ).toMatchObject({
      provider: "genx",
      purpose: "communication_draft",
      creditsDelta: 0,
      correlationId: "request-7",
      providerUsage: { totalTokens: 12 },
    });
  });
});
