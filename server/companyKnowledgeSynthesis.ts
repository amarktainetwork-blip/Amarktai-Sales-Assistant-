import { createHash } from "node:crypto";
import { z } from "zod";
import {
  buildCompanyCorpus,
  corpusPageMap,
  type CompanyCorpus,
  type CompanyCorpusInputPage,
  type CompanyCorpusPage,
} from "./companyKnowledgeCorpus";
import {
  GenxCompanyLearningClient,
  MAX_COMPANY_SEMANTIC_PASSES,
  type CompanyLearningResourceState,
} from "./genxCompanyLearning";

export type ReviewPage = CompanyCorpusInputPage;

export const OFFERING_TYPES = [
  "career_programme",
  "individual_course",
  "service",
  "product",
  "subscription",
  "package",
  "other_offering",
] as const;

export const PRICE_SEMANTIC_TYPES = [
  "full_current_price",
  "deposit",
  "finance_payment_plan",
  "alternative_plan",
  "other_fee",
] as const;

const sourceIds = z
  .array(z.string().regex(/^PAGE_\d{4}$/))
  .max(500)
  .default([]);
const strings = z
  .array(z.string().trim().min(1).max(4_000))
  .max(500)
  .default([]);

const priceSchema = z
  .object({
    value: z.string().trim().min(1).max(120),
    semanticType: z.enum(PRICE_SEMANTIC_TYPES),
    label: z.string().trim().min(1).max(300),
    sourcePageIds: sourceIds,
  })
  .strict();

const offeringSchema = z
  .object({
    id: z.string().trim().min(1).max(180),
    name: z.string().trim().min(1).max(300),
    type: z.enum(OFFERING_TYPES),
    description: z.string().trim().max(8_000).default(""),
    plans: strings,
    prices: z.array(priceSchema).max(100).default([]),
    duration: strings,
    includedCourses: strings,
    includedExams: strings,
    certifications: strings,
    awardingBodies: strings,
    financeOptions: strings,
    support: strings,
    targetCustomer: z.string().trim().max(4_000).default(""),
    entryRequirements: strings,
    outcomes: strings,
    caveats: strings,
    sourcePageIds: sourceIds,
  })
  .strict();

const sourcedFactSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    details: z.string().trim().min(1).max(8_000),
    sourcePageIds: sourceIds,
  })
  .strict();

const companySchema = z
  .object({
    name: z.string().trim().min(1).max(300),
    legalName: z.string().trim().max(300).default(""),
    description: z.string().trim().max(8_000).default(""),
    sourcePageIds: sourceIds,
  })
  .strict();

const contactSchema = z
  .object({
    type: z.enum(["email", "phone", "website", "other"]),
    value: z.string().trim().min(1).max(500),
    label: z.string().trim().max(300).default(""),
    sourcePageIds: sourceIds,
  })
  .strict();

const locationSchema = z
  .object({
    name: z.string().trim().min(1).max(500),
    address: z.string().trim().max(2_000).default(""),
    sourcePageIds: sourceIds,
  })
  .strict();

const excludedSchema = z
  .object({
    sourcePageIds: sourceIds,
    classification: z.enum([
      "category",
      "editorial",
      "testimonial",
      "comparison",
      "competitor",
      "example",
      "duplicate",
      "navigation",
      "other_non_company_content",
    ]),
    reason: z.string().trim().min(1).max(1_000),
  })
  .strict();

const conflictSchema = z
  .object({
    subject: z.string().trim().min(1).max(500),
    values: strings,
    sourcePageIds: sourceIds,
    explanation: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const companyKnowledgePackSchema = z
  .object({
    company: companySchema,
    contacts: z.array(contactSchema).max(100).default([]),
    locations: z.array(locationSchema).max(100).default([]),
    offerings: z.array(offeringSchema).max(1_000).default([]),
    finance: z.array(sourcedFactSchema).max(200).default([]),
    certificationsAndAccreditation: z
      .array(sourcedFactSchema)
      .max(200)
      .default([]),
    supportAndOutcomes: z.array(sourcedFactSchema).max(200).default([]),
    policies: z.array(sourcedFactSchema).max(200).default([]),
    refundCancellationTerms: z.array(sourcedFactSchema).max(200).default([]),
    contactKnowledge: z.array(sourcedFactSchema).max(200).default([]),
    faqs: z.array(sourcedFactSchema).max(500).default([]),
    salesUsefulFacts: z.array(sourcedFactSchema).max(500).default([]),
    excludedContent: z.array(excludedSchema).max(1_000).default([]),
    conflicts: z.array(conflictSchema).max(500).default([]),
    importantGaps: strings,
    sourceIndex: z.record(z.string(), z.string().url()).default({}),
  })
  .strict();

export type CompanyKnowledgePack = z.infer<typeof companyKnowledgePackSchema>;
export type CompanyOffering = CompanyKnowledgePack["offerings"][number];

export const companyKnowledgeAuditSchema = z
  .object({
    addOfferings: z.array(offeringSchema).max(500).default([]),
    replaceOfferings: z.array(offeringSchema).max(500).default([]),
    removeOfferingIds: strings,
    addFinance: z.array(sourcedFactSchema).max(200).default([]),
    addCertificationsAndAccreditation: z
      .array(sourcedFactSchema)
      .max(200)
      .default([]),
    addSupportAndOutcomes: z.array(sourcedFactSchema).max(200).default([]),
    addPolicies: z.array(sourcedFactSchema).max(200).default([]),
    addRefundCancellationTerms: z.array(sourcedFactSchema).max(200).default([]),
    addContactKnowledge: z.array(sourcedFactSchema).max(200).default([]),
    addContacts: z.array(contactSchema).max(100).default([]),
    addConflicts: z.array(conflictSchema).max(500).default([]),
    addExcludedContent: z.array(excludedSchema).max(1_000).default([]),
    importantGaps: strings,
  })
  .strict();

export type CompanyKnowledgeAudit = z.infer<typeof companyKnowledgeAuditSchema>;

export type WholeSiteLearningModel = {
  analyse(input: { corpus: CompanyCorpus }): Promise<unknown>;
  audit(input: {
    corpus: CompanyCorpus;
    draft: CompanyKnowledgePack;
  }): Promise<unknown>;
  repair?(input: {
    corpus: CompanyCorpus;
    kind: "analysis" | "audit";
    invalidOutput: string;
    validationError: string;
  }): Promise<unknown>;
  cleanup?(): Promise<string[]>;
  resourceState?(): CompanyLearningResourceState;
  selectedModels?(): { analysis?: string; audit?: string };
};

export type WholeSiteCheckpoint =
  | { kind: "corpus"; corpus: CompanyCorpus }
  | { kind: "analysis"; draft: CompanyKnowledgePack }
  | { kind: "audit"; audit: CompanyKnowledgeAudit }
  | { kind: "resources"; resources: CompanyLearningResourceState };

export type CompanyKnowledgeCompletenessStatus =
  | "complete"
  | "complete_with_conflicts"
  | "incomplete";

export type CompanyKnowledgeCompleteness = {
  status: CompanyKnowledgeCompletenessStatus;
  pagesDiscovered: number;
  pagesScanned: number;
  pagesCrawled: number;
  pagesSuccessfullyRead: number;
  pagesClassified: number;
  pagesUsedAsEvidence: number;
  pagesUsed: number;
  pagesExcludedWithReason: number;
  pagesExcluded: number;
  candidateSellableOfferingsDiscovered: number;
  careerProgrammesDiscovered: number;
  individualCoursesDiscovered: number;
  finalProposedOfferings: number;
  offeringsFound: number;
  offeringsWithEvidencedFullPrice: number;
  offeringsWithPublishedPrice: number;
  offeringsWithoutEvidencedFullPrice: number;
  financeInformationFound: boolean;
  contactInformationFound: boolean;
  certificationInformationFound: boolean;
  supportAndOutcomeInformationFound: boolean;
  policyTermsInformationFound: boolean;
  conflictsFound: number;
  unresolvedConflicts: number;
  importantGaps: string[];
};

export type CompanyKnowledgeSynthesisResult = {
  agentKey: "company_intelligence_review";
  available: true;
  pack: CompanyKnowledgePack;
  corpus: CompanyCorpus;
  completeness: CompanyKnowledgeCompleteness;
  reviewedAt: string;
  analysisCalls: number;
  repairCalls: number;
  totalAiCalls: number;
  cleanupFailures: string[];
  selectedModelOperations: { analysis: boolean; audit: boolean };
};

function hashKey(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function parseJson(value: unknown) {
  if (typeof value !== "string") return value;
  const withoutFence = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const first = withoutFence.indexOf("{");
  const last = withoutFence.lastIndexOf("}");
  if (first < 0 || last <= first)
    throw new Error("No structured JSON object was returned.");
  return JSON.parse(withoutFence.slice(first, last + 1)) as unknown;
}

function errorText(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, 2_000)
    : String(error).slice(0, 2_000);
}

async function parseWithBoundedRepair<T>(input: {
  raw: unknown;
  schema: z.ZodType<T>;
  kind: "analysis" | "audit";
  corpus: CompanyCorpus;
  model: WholeSiteLearningModel;
  repairBudget: { used: number };
}) {
  try {
    return input.schema.parse(parseJson(input.raw));
  } catch (firstError) {
    if (!input.model.repair || input.repairBudget.used >= 1) throw firstError;
    input.repairBudget.used += 1;
    const repaired = await input.model.repair({
      corpus: input.corpus,
      kind: input.kind,
      invalidOutput:
        typeof input.raw === "string"
          ? input.raw.slice(0, 200_000)
          : JSON.stringify(input.raw).slice(0, 200_000),
      validationError: errorText(firstError),
    });
    return input.schema.parse(parseJson(repaired));
  }
}

function analystSystemPrompt() {
  return "You are a senior business analyst and sales-enablement architect. Use only the attached canonical first-party website corpus. Understand the whole company rather than summarising pages. Return strict JSON matching the requested schema. Reference sources only by known PAGE_XXXX IDs. Separate real offerings from categories, career-path/editorial pages, testimonials, examples, comparisons and competitors. Distinguish full price, deposit, finance payment, alternative plan and other fees. Never silently resolve contradictory first-party facts.";
}

function analystPrompt() {
  return `Build the complete proposed CompanyKnowledgePack using exactly this JSON structure:
{
  "company":{"name":"","legalName":"","description":"","sourcePageIds":[]},
  "contacts":[{"type":"email|phone|website|other","value":"","label":"","sourcePageIds":[]}],
  "locations":[{"name":"","address":"","sourcePageIds":[]}],
  "offerings":[{"id":"stable-slug","name":"","type":"${OFFERING_TYPES.join("|")}","description":"","plans":[],"prices":[{"value":"","semanticType":"${PRICE_SEMANTIC_TYPES.join("|")}","label":"","sourcePageIds":[]}],"duration":[],"includedCourses":[],"includedExams":[],"certifications":[],"awardingBodies":[],"financeOptions":[],"support":[],"targetCustomer":"","entryRequirements":[],"outcomes":[],"caveats":[],"sourcePageIds":[]}],
  "finance":[],"certificationsAndAccreditation":[],"supportAndOutcomes":[],"policies":[],"refundCancellationTerms":[],"contactKnowledge":[],"faqs":[],"salesUsefulFacts":[],
  "excludedContent":[{"sourcePageIds":[],"classification":"category|editorial|testimonial|comparison|competitor|example|duplicate|navigation|other_non_company_content","reason":""}],
  "conflicts":[{"subject":"","values":[],"sourcePageIds":[],"explanation":""}],
  "importantGaps":[],"sourceIndex":{"PAGE_0001":"https://..."}
}
Every finance/certification/support/policy/refund/contact/FAQ/sales fact uses {"title":"","details":"","sourcePageIds":[]}.
Every material claim and offering must cite PAGE_XXXX IDs from the corpus. Include every real offering and deliberate conflict. Return JSON only.`;
}

function auditorSystemPrompt() {
  return "You are an independent adversarial company-knowledge auditor. Re-read the complete attached first-party corpus and try to disprove the proposed pack. Find missed offerings, false categories/editorial/examples/testimonials, duplicates, merged plans, missing or misclassified prices, finance, contacts, policies, certification, support, contradictions, unsupported claims and important omissions. Return corrections as the strict patch shape requested; do not return a replacement pack.";
}

function auditorPrompt(draft: CompanyKnowledgePack) {
  return `Audit this proposed pack against the attached corpus:\n${JSON.stringify(draft)}\n\nReturn JSON only with this patch structure: {"addOfferings":[],"replaceOfferings":[],"removeOfferingIds":[],"addFinance":[],"addCertificationsAndAccreditation":[],"addSupportAndOutcomes":[],"addPolicies":[],"addRefundCancellationTerms":[],"addContactKnowledge":[],"addContacts":[],"addConflicts":[],"addExcludedContent":[],"importantGaps":[]}. Added/replaced offerings and facts must use the exact structures from the proposed pack and cite only known PAGE_XXXX IDs.`;
}

class DefaultWholeSiteModel implements WholeSiteLearningModel {
  private readonly client = new GenxCompanyLearningClient();
  private resources: CompanyLearningResourceState = { sessionIds: [] };
  private models?: Awaited<
    ReturnType<GenxCompanyLearningClient["selectModels"]>
  >;

  constructor(
    private readonly input: {
      userId: number;
      organisationId: number;
      reference: string;
      onResource?: (
        resources: CompanyLearningResourceState
      ) => Promise<void> | void;
    }
  ) {}

  private async ensureFile(corpus: CompanyCorpus) {
    this.models ||= await this.client.selectModels();
    if (!this.resources.fileId) {
      this.resources.fileId = await this.client.uploadCorpus(corpus);
      await this.input.onResource?.(this.resourceState());
    }
    return this.resources.fileId;
  }

  private async run(input: {
    corpus: CompanyCorpus;
    kind: "analysis" | "audit" | "repair";
    systemPrompt: string;
    prompt: string;
    auditModel?: boolean;
  }) {
    const fileId = await this.ensureFile(input.corpus);
    const model = input.auditModel
      ? this.models!.audit.id
      : this.models!.analysis.id;
    const sessionId = await this.client.createSession({
      model,
      systemPrompt: input.systemPrompt,
      title: `Amarktai company ${input.kind}`,
    });
    this.resources.sessionIds.push(sessionId);
    await this.input.onResource?.(this.resourceState());
    const result = await this.client.sendSessionMessage({
      sessionId,
      content: input.prompt,
      fileIds: [fileId],
      idempotencyKey: hashKey(
        `${this.input.reference}:${input.kind}:${input.corpus.corpusHash}`
      ),
      billing: {
        userId: this.input.userId,
        organisationId: this.input.organisationId,
        feature: `company_learning_${input.kind}`,
        reference: `${this.input.reference}:${input.kind}:${input.corpus.corpusHash}`,
      },
    });
    await this.client.closeSession(sessionId);
    this.resources.sessionIds = this.resources.sessionIds.filter(
      id => id !== sessionId
    );
    await this.input.onResource?.(this.resourceState());
    return result.content;
  }

  analyse({ corpus }: { corpus: CompanyCorpus }) {
    return this.run({
      corpus,
      kind: "analysis",
      systemPrompt: analystSystemPrompt(),
      prompt: analystPrompt(),
    });
  }

  audit({
    corpus,
    draft,
  }: {
    corpus: CompanyCorpus;
    draft: CompanyKnowledgePack;
  }) {
    return this.run({
      corpus,
      kind: "audit",
      systemPrompt: auditorSystemPrompt(),
      prompt: auditorPrompt(draft),
      auditModel: true,
    });
  }

  repair(input: {
    corpus: CompanyCorpus;
    kind: "analysis" | "audit";
    invalidOutput: string;
    validationError: string;
  }) {
    return this.run({
      corpus: input.corpus,
      kind: "repair",
      systemPrompt:
        "Repair invalid structured company-learning JSON. Do not add facts. Keep only PAGE_XXXX IDs present in the attached corpus. Return JSON only.",
      prompt: `Repair this ${input.kind} output to its required schema. Validation error: ${input.validationError}\n\nInvalid output:\n${input.invalidOutput}`,
      auditModel: input.kind === "audit",
    });
  }

  async cleanup() {
    const failures = await this.client.cleanup(this.resources);
    if (!failures.length) this.resources = { sessionIds: [] };
    await this.input.onResource?.(this.resourceState());
    return failures;
  }

  resourceState() {
    return {
      fileId: this.resources.fileId,
      sessionIds: [...this.resources.sessionIds],
    };
  }

  selectedModels() {
    return { analysis: this.models?.analysis.id, audit: this.models?.audit.id };
  }
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function normalise(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9£$€]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pageEvidence(page: CompanyCorpusPage) {
  return normalise(
    [page.title, page.primaryHeading, ...page.headings, page.text]
      .filter(Boolean)
      .join(" ")
  );
}

function knownSources(ids: string[], pages: Map<string, CompanyCorpusPage>) {
  return unique(ids).filter(id => pages.has(id));
}

function claimSupported(
  value: string,
  sourceIds: string[],
  pages: Map<string, CompanyCorpusPage>
) {
  const needle = normalise(value);
  return (
    Boolean(needle) &&
    sourceIds.some(id => pageEvidence(pages.get(id)!).includes(needle))
  );
}

function importantNameSupported(
  name: string,
  sourceIds: string[],
  pages: Map<string, CompanyCorpusPage>
) {
  const needle = normalise(name);
  if (!needle) return false;
  const tokens = needle.split(" ").filter(token => token.length > 2);
  return sourceIds.some(id => {
    const evidence = pageEvidence(pages.get(id)!);
    return (
      evidence.includes(needle) ||
      (tokens.length > 1 && tokens.every(token => evidence.includes(token)))
    );
  });
}

function moneyNumbers(value: string) {
  return Array.from(
    value.matchAll(
      /(?:£|\$|€|gbp|usd|eur)\s*(\d+(?:[,.]\d{3})*(?:[,.]\d{1,2})?)|(\d+(?:[,.]\d{3})*(?:[,.]\d{1,2})?)\s*(?:gbp|usd|eur)/gi
    )
  )
    .map(match =>
      (match[1] || match[2])
        .replace(/[,.](?=\d{3}(?:\D|$))/g, "")
        .replace(",", ".")
    )
    .filter(Boolean);
}

function priceSupported(
  value: string,
  sourceIds: string[],
  pages: Map<string, CompanyCorpusPage>
) {
  const amounts = moneyNumbers(value);
  if (!amounts.length) return false;
  return sourceIds.some(id => {
    const pageAmounts = new Set(moneyNumbers(pages.get(id)!.text));
    return amounts.every(amount => pageAmounts.has(amount));
  });
}

function priceContext(
  value: string,
  sourceIds: string[],
  pages: Map<string, CompanyCorpusPage>
) {
  const targetAmount = moneyNumbers(value)[0];
  if (!targetAmount) return "";
  for (const id of sourceIds) {
    const text = pages.get(id)!.text;
    for (const match of Array.from(
      text.matchAll(
        /(?:£|\$|€|gbp|usd|eur)\s*(\d+(?:[,.]\d{3})*(?:[,.]\d{1,2})?)|(\d+(?:[,.]\d{3})*(?:[,.]\d{1,2})?)\s*(?:gbp|usd|eur)/gi
      )
    )) {
      const amount = (match[1] || match[2])
        .replace(/[,.](?=\d{3}(?:\D|$))/g, "")
        .replace(",", ".");
      if (amount !== targetAmount) continue;
      const index = match.index || 0;
      return normalise(
        text.slice(Math.max(0, index - 45), index + match[0].length + 55)
      );
    }
  }
  return "";
}

function safeOfferingPage(
  offering: CompanyOffering,
  sourceIds: string[],
  pages: Map<string, CompanyCorpusPage>
) {
  return sourceIds.some(id => {
    const page = pages.get(id)!;
    const path = new URL(page.url).pathname.toLowerCase().replace(/\/$/, "");
    if (/\/(?:blog|articles?|career-paths?|guides?|news)(?:\/|$)/.test(path))
      return false;
    if (
      /\/(?:courses?|programmes?|products?|services?|category|catalogue)$/.test(
        path
      )
    )
      return false;
    return !(
      offering.type === "career_programme" &&
      /career-path/.test(`${path} ${page.pageHint}`)
    );
  });
}

function validatePrice(
  price: CompanyOffering["prices"][number],
  offeringSources: string[],
  pages: Map<string, CompanyCorpusPage>
) {
  const sourcePageIds = knownSources(
    price.sourcePageIds.length ? price.sourcePageIds : offeringSources,
    pages
  );
  if (
    !sourcePageIds.length ||
    !priceSupported(price.value, sourcePageIds, pages)
  )
    return undefined;
  const context = priceContext(price.value, sourcePageIds, pages);
  const label = normalise(price.label);
  const labelledPriceMeaning =
    /full|current|total|deposit|monthly|finance|fee|plan|price|cost/.test(
      label
    );
  if (
    /salary|salary range|earn(?:ing|s)?|income|per annum|per year/.test(
      label
    ) ||
    (!labelledPriceMeaning &&
      /salary|salary range|earn(?:ing|s)?|income|per annum|per year/.test(
        context
      ))
  )
    return undefined;
  let semanticType = price.semanticType;
  if (
    semanticType === "full_current_price" &&
    /deposit|upfront|initial payment/.test(label)
  )
    semanticType = "deposit";
  else if (
    semanticType === "full_current_price" &&
    /per month|monthly|instalment|installment|finance payment/.test(label)
  )
    semanticType = "finance_payment_plan";
  else if (
    semanticType === "full_current_price" &&
    /exam fee|assessment fee|registration fee/.test(label)
  )
    semanticType = "other_fee";
  else if (
    semanticType === "full_current_price" &&
    !/full|current|total|course price|programme price|program price/.test(label)
  ) {
    if (/deposit|upfront|initial payment/.test(context))
      semanticType = "deposit";
    else if (
      /per month|monthly|instalment|installment|finance payment/.test(context)
    )
      semanticType = "finance_payment_plan";
    else if (/exam fee|assessment fee|registration fee/.test(context))
      semanticType = "other_fee";
  }
  return { ...price, semanticType, sourcePageIds };
}

function validateSourcedFact<
  T extends { title: string; details: string; sourcePageIds: string[] },
>(fact: T, pages: Map<string, CompanyCorpusPage>, strict = false) {
  const sourcePageIds = knownSources(fact.sourcePageIds, pages);
  if (!sourcePageIds.length) return undefined;
  if (
    strict &&
    !claimSupported(fact.title, sourcePageIds, pages) &&
    !claimSupported(fact.details, sourcePageIds, pages)
  )
    return undefined;
  return { ...fact, sourcePageIds };
}

export function applyCompanyKnowledgeAudit(
  draft: CompanyKnowledgePack,
  audit: CompanyKnowledgeAudit
): CompanyKnowledgePack {
  const removals = new Set(audit.removeOfferingIds.map(normalise));
  const replacements = new Map(
    audit.replaceOfferings.map(item => [normalise(item.id), item])
  );
  const retained = draft.offerings
    .filter(item => !removals.has(normalise(item.id)))
    .map(item => replacements.get(normalise(item.id)) || item);
  const retainedIds = new Set(retained.map(item => normalise(item.id)));
  return {
    ...draft,
    offerings: [
      ...retained,
      ...audit.addOfferings.filter(
        item => !retainedIds.has(normalise(item.id))
      ),
    ],
    contacts: [...draft.contacts, ...audit.addContacts],
    finance: [...draft.finance, ...audit.addFinance],
    certificationsAndAccreditation: [
      ...draft.certificationsAndAccreditation,
      ...audit.addCertificationsAndAccreditation,
    ],
    supportAndOutcomes: [
      ...draft.supportAndOutcomes,
      ...audit.addSupportAndOutcomes,
    ],
    policies: [...draft.policies, ...audit.addPolicies],
    refundCancellationTerms: [
      ...draft.refundCancellationTerms,
      ...audit.addRefundCancellationTerms,
    ],
    contactKnowledge: [...draft.contactKnowledge, ...audit.addContactKnowledge],
    conflicts: [...draft.conflicts, ...audit.addConflicts],
    excludedContent: [...draft.excludedContent, ...audit.addExcludedContent],
    importantGaps: unique([...draft.importantGaps, ...audit.importantGaps]),
  };
}

function sourceIndex(corpus: CompanyCorpus) {
  return Object.fromEntries(corpus.pages.map(page => [page.pageId, page.url]));
}

function deterministicConflicts(
  offerings: CompanyOffering[],
  existing: CompanyKnowledgePack["conflicts"]
) {
  const conflicts = [...existing];
  for (const offering of offerings) {
    const full = offering.prices.filter(
      price => price.semanticType === "full_current_price"
    );
    const values = new Set(full.map(price => normalise(price.value)));
    if (values.size <= 1) continue;
    const candidate = {
      subject: `${offering.name} current price`,
      values: unique(full.map(price => price.value)),
      sourcePageIds: unique(full.flatMap(price => price.sourcePageIds)),
      explanation:
        "Different first-party pages publish different full/current prices. Human review is required.",
    };
    if (
      !conflicts.some(
        conflict => normalise(conflict.subject) === normalise(candidate.subject)
      )
    )
      conflicts.push(candidate);
  }
  return conflicts;
}

export function validateCompanyKnowledgePack(
  proposed: CompanyKnowledgePack,
  corpus: CompanyCorpus
) {
  const pages = corpusPageMap(corpus);
  const gaps = [...proposed.importantGaps];
  const offerings: CompanyOffering[] = [];
  const seen = new Set<string>();
  for (const offering of proposed.offerings) {
    const sourcePageIds = knownSources(offering.sourcePageIds, pages);
    if (
      !sourcePageIds.length ||
      !importantNameSupported(offering.name, sourcePageIds, pages) ||
      !safeOfferingPage(offering, sourcePageIds, pages)
    ) {
      gaps.push(
        `A proposed offering named “${offering.name}” was removed because its core identity was not grounded on an offering page.`
      );
      continue;
    }
    const prices = offering.prices
      .map(price => validatePrice(price, sourcePageIds, pages))
      .filter((price): price is NonNullable<typeof price> => Boolean(price));
    const key = `${normalise(offering.name)}|${offering.type}|${normalise(offering.plans.join("|"))}`;
    if (seen.has(key)) {
      const existing = offerings.find(
        item =>
          `${normalise(item.name)}|${item.type}|${normalise(item.plans.join("|"))}` ===
          key
      )!;
      existing.sourcePageIds = unique([
        ...existing.sourcePageIds,
        ...sourcePageIds,
      ]);
      existing.prices = [...existing.prices, ...prices].filter(
        (price, index, all) =>
          all.findIndex(
            candidate =>
              candidate.value === price.value &&
              candidate.semanticType === price.semanticType &&
              candidate.label === price.label &&
              candidate.sourcePageIds.join("|") ===
                price.sourcePageIds.join("|")
          ) === index
      );
      continue;
    }
    seen.add(key);
    const supported = (values: string[]) =>
      values.filter(value => claimSupported(value, sourcePageIds, pages));
    offerings.push({
      ...offering,
      sourcePageIds,
      prices,
      duration: supported(offering.duration),
      includedCourses: supported(offering.includedCourses),
      includedExams: supported(offering.includedExams),
      certifications: supported(offering.certifications),
      awardingBodies: supported(offering.awardingBodies),
      financeOptions: supported(offering.financeOptions),
      entryRequirements: supported(offering.entryRequirements),
      caveats: supported(offering.caveats),
    });
  }
  const contacts = proposed.contacts.flatMap(contact => {
    const sourcePageIds = knownSources(contact.sourcePageIds, pages);
    return sourcePageIds.length &&
      claimSupported(contact.value, sourcePageIds, pages)
      ? [{ ...contact, sourcePageIds }]
      : [];
  });
  const locations = proposed.locations.flatMap(location => {
    const sourcePageIds = knownSources(location.sourcePageIds, pages);
    return sourcePageIds.length &&
      (claimSupported(location.name, sourcePageIds, pages) ||
        claimSupported(location.address, sourcePageIds, pages))
      ? [{ ...location, sourcePageIds }]
      : [];
  });
  const facts = <
    T extends { title: string; details: string; sourcePageIds: string[] },
  >(
    items: T[],
    strict = false
  ) =>
    items
      .map(item => validateSourcedFact(item, pages, strict))
      .filter((item): item is T => Boolean(item));
  const excludedContent = proposed.excludedContent.flatMap(item => {
    const sourcePageIds = knownSources(item.sourcePageIds, pages);
    return sourcePageIds.length ? [{ ...item, sourcePageIds }] : [];
  });
  const conflicts = deterministicConflicts(
    offerings,
    proposed.conflicts.flatMap(conflict => {
      const sourcePageIds = knownSources(conflict.sourcePageIds, pages);
      return sourcePageIds.length > 1 ? [{ ...conflict, sourcePageIds }] : [];
    })
  );
  return companyKnowledgePackSchema.parse({
    ...proposed,
    company: {
      ...proposed.company,
      sourcePageIds: knownSources(proposed.company.sourcePageIds, pages),
    },
    contacts,
    locations,
    offerings,
    finance: facts(proposed.finance),
    certificationsAndAccreditation: facts(
      proposed.certificationsAndAccreditation,
      true
    ),
    supportAndOutcomes: facts(proposed.supportAndOutcomes),
    policies: facts(proposed.policies),
    refundCancellationTerms: facts(proposed.refundCancellationTerms),
    contactKnowledge: facts(proposed.contactKnowledge),
    faqs: facts(proposed.faqs),
    salesUsefulFacts: facts(proposed.salesUsefulFacts),
    excludedContent,
    conflicts,
    importantGaps: unique(gaps),
    sourceIndex: sourceIndex(corpus),
  });
}

function pageLikelyOffering(page: CompanyCorpusPage) {
  const target =
    `${new URL(page.url).pathname} ${page.pageHint} ${page.title || ""} ${page.primaryHeading || ""}`.toLowerCase();
  if (
    /blog|article|career-path|guide|category|testimonial|comparison/.test(
      target
    )
  )
    return false;
  if (
    !/course|programme|program|product|service|subscription|package/.test(
      target
    )
  )
    return false;
  const path = new URL(page.url).pathname.replace(/\/$/, "");
  return !/^\/(?:courses?|programmes?|products?|services?)$/i.test(path);
}

export function calculateCompanyKnowledgeCompleteness(
  pack: CompanyKnowledgePack,
  corpus: CompanyCorpus
) {
  const used = new Set<string>([
    ...pack.company.sourcePageIds,
    ...pack.contacts.flatMap(item => item.sourcePageIds),
    ...pack.locations.flatMap(item => item.sourcePageIds),
    ...pack.offerings.flatMap(item => [
      ...item.sourcePageIds,
      ...item.prices.flatMap(price => price.sourcePageIds),
    ]),
    ...[
      pack.finance,
      pack.certificationsAndAccreditation,
      pack.supportAndOutcomes,
      pack.policies,
      pack.refundCancellationTerms,
      pack.contactKnowledge,
      pack.faqs,
      pack.salesUsefulFacts,
    ]
      .flat()
      .flatMap(item => item.sourcePageIds),
  ]);
  const offeringPages = new Set(
    pack.offerings.flatMap(item => item.sourcePageIds)
  );
  const missingLikely = corpus.pages.filter(
    page => pageLikelyOffering(page) && !offeringPages.has(page.pageId)
  );
  const careerProgrammes = pack.offerings.filter(
    item => item.type === "career_programme"
  ).length;
  const individualCourses = pack.offerings.filter(
    item => item.type === "individual_course"
  ).length;
  const priced = pack.offerings.filter(item =>
    item.prices.some(price => price.semanticType === "full_current_price")
  ).length;
  const importantGaps = unique([
    ...pack.importantGaps,
    ...(missingLikely.length
      ? [
          `${missingLikely.length} likely offering page(s) were not represented in the final pack.`,
        ]
      : []),
    ...(!pack.offerings.length
      ? ["No source-grounded offerings were found in the complete corpus."]
      : []),
  ]);
  const incomplete =
    !pack.offerings.length ||
    missingLikely.length > Math.max(3, Math.ceil(corpus.pageCount * 0.05));
  const status: CompanyKnowledgeCompletenessStatus = incomplete
    ? "incomplete"
    : pack.conflicts.length
      ? "complete_with_conflicts"
      : "complete";
  return {
    status,
    pagesDiscovered: corpus.pageCount,
    pagesScanned: corpus.pageCount,
    pagesCrawled: corpus.pageCount,
    pagesSuccessfullyRead: corpus.pageCount,
    pagesClassified: corpus.pageCount,
    pagesUsedAsEvidence: used.size,
    pagesUsed: used.size,
    pagesExcludedWithReason: pack.excludedContent.length,
    pagesExcluded: pack.excludedContent.length,
    candidateSellableOfferingsDiscovered:
      corpus.pages.filter(pageLikelyOffering).length,
    careerProgrammesDiscovered: careerProgrammes,
    individualCoursesDiscovered: individualCourses,
    finalProposedOfferings: pack.offerings.length,
    offeringsFound: pack.offerings.length,
    offeringsWithEvidencedFullPrice: priced,
    offeringsWithPublishedPrice: priced,
    offeringsWithoutEvidencedFullPrice: Math.max(
      0,
      pack.offerings.length - priced
    ),
    financeInformationFound:
      pack.finance.length > 0 ||
      pack.offerings.some(
        item =>
          item.financeOptions.length > 0 ||
          item.prices.some(price =>
            ["deposit", "finance_payment_plan"].includes(price.semanticType)
          )
      ),
    contactInformationFound:
      pack.contacts.length > 0 || pack.contactKnowledge.length > 0,
    certificationInformationFound:
      pack.certificationsAndAccreditation.length > 0 ||
      pack.offerings.some(
        item => item.certifications.length > 0 || item.awardingBodies.length > 0
      ),
    supportAndOutcomeInformationFound:
      pack.supportAndOutcomes.length > 0 ||
      pack.offerings.some(
        item => item.support.length > 0 || item.outcomes.length > 0
      ),
    policyTermsInformationFound:
      pack.policies.length > 0 || pack.refundCancellationTerms.length > 0,
    conflictsFound: pack.conflicts.length,
    unresolvedConflicts: pack.conflicts.length,
    importantGaps,
  } satisfies CompanyKnowledgeCompleteness;
}

export async function synthesiseCompanyKnowledge(input: {
  userId: number;
  organisationId: number;
  pages: ReviewPage[];
  reference: string;
  model?: WholeSiteLearningModel;
  resume?: {
    corpus?: CompanyCorpus;
    draft?: CompanyKnowledgePack;
    audit?: CompanyKnowledgeAudit;
  };
  onCheckpoint?: (checkpoint: WholeSiteCheckpoint) => Promise<void> | void;
  onPhase?: (
    phase: "corpus" | "analysis" | "audit" | "validation" | "completeness"
  ) => Promise<void> | void;
}): Promise<CompanyKnowledgeSynthesisResult> {
  const corpus = input.resume?.corpus || buildCompanyCorpus(input.pages);
  await input.onCheckpoint?.({ kind: "corpus", corpus });
  await input.onPhase?.("corpus");
  const model =
    input.model ||
    new DefaultWholeSiteModel({
      userId: input.userId,
      organisationId: input.organisationId,
      reference: input.reference,
      onResource: resources =>
        input.onCheckpoint?.({ kind: "resources", resources }),
    });
  const repairBudget = { used: 0 };
  let analysisCalls = 0;
  let result: CompanyKnowledgeSynthesisResult | undefined;
  let cleanupFailures: string[] = [];
  try {
    await input.onPhase?.("analysis");
    const draft =
      input.resume?.draft ||
      (await (async () => {
        analysisCalls += 1;
        const parsed = await parseWithBoundedRepair({
          raw: await model.analyse({ corpus }),
          schema: companyKnowledgePackSchema,
          kind: "analysis",
          corpus,
          model,
          repairBudget,
        });
        await input.onCheckpoint?.({ kind: "analysis", draft: parsed });
        return parsed;
      })());
    await input.onPhase?.("audit");
    const audit =
      input.resume?.audit ||
      (await (async () => {
        analysisCalls += 1;
        const parsed = await parseWithBoundedRepair({
          raw: await model.audit({ corpus, draft }),
          schema: companyKnowledgeAuditSchema,
          kind: "audit",
          corpus,
          model,
          repairBudget,
        });
        await input.onCheckpoint?.({ kind: "audit", audit: parsed });
        return parsed;
      })());
    if (analysisCalls + repairBudget.used > MAX_COMPANY_SEMANTIC_PASSES)
      throw new Error(
        "Company learning exceeded its bounded semantic-pass contract."
      );
    await input.onPhase?.("validation");
    const pack = validateCompanyKnowledgePack(
      applyCompanyKnowledgeAudit(draft, audit),
      corpus
    );
    await input.onPhase?.("completeness");
    result = {
      agentKey: "company_intelligence_review",
      available: true,
      pack,
      corpus,
      completeness: calculateCompanyKnowledgeCompleteness(pack, corpus),
      reviewedAt: new Date().toISOString(),
      analysisCalls,
      repairCalls: repairBudget.used,
      totalAiCalls: analysisCalls + repairBudget.used,
      cleanupFailures: [],
      selectedModelOperations: {
        analysis: Boolean(model.selectedModels?.().analysis),
        audit: Boolean(model.selectedModels?.().audit),
      },
    };
  } finally {
    cleanupFailures = (await model.cleanup?.()) || [];
  }
  if (!result) throw new Error("Company learning did not produce a result.");
  result.cleanupFailures = cleanupFailures;
  if (cleanupFailures.length) {
    result.completeness.status = "incomplete";
    result.completeness.importantGaps.push(
      "Temporary company-learning resources require cleanup before this job can complete."
    );
  }
  return result;
}
