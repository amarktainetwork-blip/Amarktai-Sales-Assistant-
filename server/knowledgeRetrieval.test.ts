import { describe, expect, it } from "vitest";
import { rankApprovedKnowledgeSources } from "./db";

const date = new Date("2026-09-26T10:00:00.000Z");
const source = (id: number, title: string, content: string) => ({
  id,
  title,
  content,
  sourceUrl: "https://example.test/evidence",
  updatedAt: date,
});

describe("approved knowledge relevance", () => {
  const sources = [
    source(
      435,
      "Cyber Security Career Programme — standard pricing and access",
      "STANDARD PUBLIC PROGRAMME: Cyber Security Career Programme. Total standard price: £1,899 inclusive of VAT. £1 deposit and flexible finance up to 48 months. Do not substitute ELCAS-specific pricing for the standard public price."
    ),
    source(
      436,
      "Cyber Security Career Programme — ELCAS pricing context",
      "ELCAS-SPECIFIC CONTEXT ONLY: the Cyber Security programme ELCAS fee is £1,857. This is not the standard public retail price."
    ),
    source(
      500,
      "General finance options",
      "Flexible finance and payment options are available subject to status."
    ),
  ];

  it("returns standard Cyber Security pricing without leaking ELCAS-only context", () => {
    const result = rankApprovedKnowledgeSources(
      sources,
      "Cyber Security price deposit finance"
    );
    expect(result[0]?.id).toBe(435);
    expect(result.some(item => item.id === 436)).toBe(false);
  });

  it("ranks ELCAS-specific Cyber Security context when ELCAS is explicit", () => {
    const result = rankApprovedKnowledgeSources(
      sources,
      "Cyber Security ELCAS price"
    );
    expect(result[0]?.id).toBe(436);
  });

  it("returns no unrelated course pricing for an unknown product identity", () => {
    expect(
      rankApprovedKnowledgeSources(
        sources,
        "Quantum submarine course price"
      )
    ).toEqual([]);
  });

  it("still supports organisation-wide commercial questions with no product identity", () => {
    const result = rankApprovedKnowledgeSources(sources, "finance options");
    expect(result.some(item => item.id === 500)).toBe(true);
  });
});
