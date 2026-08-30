import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CompanyKnowledgeOutputError,
  parseCanonicalCompanyKnowledgeOutput,
} from "./companyKnowledgeModelOutput";

const conflictSchema = z
  .object({
    subject: z.string().min(1),
    values: z.array(z.string().min(1)).min(2),
    sourcePageIds: z.array(z.string().regex(/^PAGE_\d{4}$/)).min(2),
    explanation: z.string().min(1),
  })
  .strict();

const partialSchema = z
  .object({
    conflicts: z.array(conflictSchema).default([]),
  })
  .partial();

const auditSchema = z
  .object({
    addConflicts: z.array(conflictSchema).default([]),
  })
  .partial();

describe("batched company-learning conflict compatibility", () => {
  it("drops an incomplete one-source conflict candidate in partial analysis", () => {
    const parsed = parseCanonicalCompanyKnowledgeOutput({
      raw: {
        conflicts: [
          {
            subject: "Programme price",
            values: ["£2,499", "£2,699"],
            sourcePageIds: ["PAGE_0066"],
            explanation: "Possible conflict within this bounded batch.",
          },
        ],
      },
      mode: "partial_analysis",
      schema: partialSchema,
      context: {
        phase: "analysis",
        batchIndex: 22,
        batchTotal: 36,
        pageIds: ["PAGE_0066", "PAGE_0067", "PAGE_0068", "PAGE_0069"],
      },
    });

    expect(parsed.data.conflicts).toEqual([]);
    expect(parsed.normalizationActions).toContain(
      "conflicts[0]:removed_blank_placeholder"
    );
  });

  it("retains a fully evidenced two-source partial conflict", () => {
    const parsed = parseCanonicalCompanyKnowledgeOutput({
      raw: {
        conflicts: [
          {
            subject: "Programme price",
            values: ["£2,499", "£2,699"],
            sourcePageIds: ["PAGE_0066", "PAGE_0067"],
            explanation: "Two first-party pages publish different prices.",
          },
        ],
      },
      mode: "partial_analysis",
      schema: partialSchema,
      context: {
        phase: "analysis",
        pageIds: ["PAGE_0066", "PAGE_0067"],
      },
    });

    expect(parsed.data.conflicts).toHaveLength(1);
  });

  it("drops an incomplete noncanonical conflict candidate in a bounded audit batch", () => {
    const parsed = parseCanonicalCompanyKnowledgeOutput({
      raw: {
        addConflicts: [
          {
            sourcePageIds: ["PAGE_0001", "PAGE_0002"],
            candidate: "Possible contradiction requiring further evidence.",
            evidence: ["first statement", "second statement"],
          },
        ],
      },
      mode: "audit",
      schema: auditSchema,
      context: {
        phase: "audit",
        batchIndex: 2,
        batchTotal: 36,
        pageIds: ["PAGE_0001", "PAGE_0002"],
      },
    });

    expect(parsed.data.addConflicts).toEqual([]);
    expect(parsed.normalizationActions).toContain(
      "addConflicts[0]:removed_blank_placeholder"
    );
  });

  it("retains a fully evidenced audit conflict", () => {
    const parsed = parseCanonicalCompanyKnowledgeOutput({
      raw: {
        addConflicts: [
          {
            subject: "Programme price",
            values: ["£2,499", "£2,699"],
            sourcePageIds: ["PAGE_0001", "PAGE_0002"],
            explanation: "Two first-party pages publish different prices.",
          },
        ],
      },
      mode: "audit",
      schema: auditSchema,
      context: {
        phase: "audit",
        batchIndex: 2,
        batchTotal: 36,
        pageIds: ["PAGE_0001", "PAGE_0002"],
      },
    });

    expect(parsed.data.addConflicts).toHaveLength(1);
  });

  it("keeps strict validation for complete audit conflicts with extra keys", () => {
    expect(() =>
      parseCanonicalCompanyKnowledgeOutput({
        raw: {
          addConflicts: [
            {
              subject: "Programme price",
              values: ["£2,499", "£2,699"],
              sourcePageIds: ["PAGE_0001", "PAGE_0002"],
              explanation: "Two first-party pages publish different prices.",
              confidence: "high",
            },
          ],
        },
        mode: "audit",
        schema: auditSchema,
        context: {
          phase: "audit",
          batchIndex: 2,
          batchTotal: 36,
          pageIds: ["PAGE_0001", "PAGE_0002"],
        },
      })
    ).toThrow(CompanyKnowledgeOutputError);
  });

  it("does not weaken full-analysis conflict validation", () => {
    expect(() =>
      parseCanonicalCompanyKnowledgeOutput({
        raw: {
          conflicts: [
            {
              subject: "Programme price",
              values: ["£2,499", "£2,699"],
              sourcePageIds: ["PAGE_0066"],
              explanation: "Incomplete final conflict evidence.",
            },
          ],
        },
        mode: "full_analysis",
        schema: partialSchema,
        context: {
          phase: "analysis",
          pageIds: ["PAGE_0066", "PAGE_0067"],
        },
      })
    ).toThrow(CompanyKnowledgeOutputError);
  });
});
