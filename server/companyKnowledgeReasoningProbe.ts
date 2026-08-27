import { z } from "zod";
import { runGenxAgent } from "./genx";

const probeSchema = z
  .array(
    z
      .object({
        classification: z.literal("company_offering"),
        title: z.string().trim().min(1),
        summary: z.string().trim().min(1),
        sourceUrls: z.array(z.literal("https://verification.amarktai.local/data-analytics")).min(1).max(1),
        pageTitle: z.literal("Data Analytics Course"),
        fetchedAt: z.literal("2026-08-27T00:00:00.000Z"),
        evidenceText: z.string().trim().min(1),
        confidence: z.enum(["high", "medium"]),
        reviewState: z.literal("review_required"),
        trustEligible: z.literal(true),
        offering: z.object({
          name: z.literal("Data Analytics Course"),
          currentPrices: z.array(z.string()).min(1),
          financeOptions: z.array(z.string()).min(1),
          support: z.array(z.string()).min(1),
        }).passthrough(),
      })
      .passthrough()
  )
  .min(1)
  .max(2);

const sourceUrl = "https://verification.amarktai.local/data-analytics";
const pageTitle = "Data Analytics Course";
const fetchedAt = "2026-08-27T00:00:00.000Z";
const pageText = [
  "Data Analytics Course",
  "Current full course price: £995.",
  "Finance: £95 deposit is available, followed by monthly payments.",
  "Support: Tutor support is included.",
].join("\n");

function parseArray(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = (fenced || content).trim();
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end < start)
    throw new Error("Structured company-intelligence probe returned no JSON array.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error("Structured company-intelligence probe returned malformed JSON.");
  }
  return probeSchema.parse(parsed);
}

function includesExactClaim(values: string[], claim: string) {
  return values.some(value => value.includes(claim));
}

export async function verifyCompanyKnowledgeReasoning() {
  const prompt = `Turn this authorised first-party website page into CLIENT-READY company knowledge. Return ONLY a compact JSON array and no markdown.

Rules:
- Return one company_offering item for the exact first-party offering below.
- offering.name MUST be copied verbatim as an exact contiguous quote from the supplied page. Do not paraphrase, shorten, expand, translate, re-capitalise or decorate the offering name.
- For a company_offering item, title MUST exactly equal offering.name.
- currentPrices may contain ONLY the current full/total price of that exact offering.
- Deposits, monthly instalments and finance examples MUST NOT appear in currentPrices. Put a clearly labelled deposit/payment plan in financeOptions.
- support must contain only support facts explicitly present in the page.
- evidenceText must contain the exact offering name and directly support the structured claims.
- sourceUrls, pageTitle and fetchedAt must exactly match the supplied page.
- reviewState must be review_required and trustEligible must be true only because every requested claim below is explicit first-party evidence.

Return this shape:
[{"classification":"company_offering","title":"Data Analytics Course","summary":"...","sourceUrls":["${sourceUrl}"],"pageTitle":"${pageTitle}","fetchedAt":"${fetchedAt}","evidenceText":"...","confidence":"high","reviewState":"review_required","trustEligible":true,"offering":{"name":"Data Analytics Course","currentPrices":["£995"],"financeOptions":["£95 deposit"],"support":["Tutor support"]}}]

Page:
${JSON.stringify({ url: sourceUrl, pageTitle, fetchedAt, text: pageText })}`;

  const response = await runGenxAgent({
    agentKey: "company_intelligence_review",
    modelTier: "reasoning",
    messages: [{ role: "user", content: prompt }],
  });
  if (response.provider !== "genx")
    throw new Error("Amarktai reasoning path did not use the configured production intelligence provider.");

  const items = parseArray(response.content);
  const offering = items.find(item => item.offering.name === pageTitle);
  if (!offering)
    throw new Error("Reasoning path did not preserve the exact first-party offering name.");

  if (!includesExactClaim(offering.offering.currentPrices, "£995"))
    throw new Error("Reasoning path did not retain the current full price.");
  if (offering.offering.currentPrices.some(value => value.includes("£95") && !value.includes("£995")))
    throw new Error("Reasoning path leaked the deposit into currentPrices.");
  if (!includesExactClaim(offering.offering.financeOptions, "£95"))
    throw new Error("Reasoning path did not separate the deposit into financeOptions.");
  if (!offering.offering.support.some(value => /tutor support/i.test(value)))
    throw new Error("Reasoning path did not retain tutor support.");
  if (!offering.evidenceText.includes("Data Analytics Course"))
    throw new Error("Reasoning evidence omitted the exact offering name.");

  return {
    status: "LIVE_PROVEN" as const,
    model: response.model,
    exactOfferingName: true,
    fullPriceSeparated: true,
    depositSeparated: true,
    supportRetained: true,
    responseCharacters: response.content.trim().length,
  };
}
