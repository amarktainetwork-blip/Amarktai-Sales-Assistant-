export type CommercialStageMapping = {
  connectedSystemId: number;
  externalStageId: string;
  stageLabel: string;
  category: string;
  isActive?: boolean;
};

export type CommercialOpportunity = {
  connectedSystemId: number;
  externalId: string;
  pipeline?: string | null;
  stage?: string | null;
  closeAt?: Date | null;
  sourceUpdatedAt?: Date | null;
  updatedAt?: Date | null;
  raw?: unknown;
};

export type CommercialMappedField = {
  label: string;
  purpose?: string | null;
  value: unknown;
};

export type CommercialTruth = {
  payment: {
    state: "paid" | "not_proven" | "unknown";
    latestOpportunityExternalId: string | null;
    latestOpportunityStage: string | null;
    latestPaidAt: Date | null;
    latestPaidOpportunityExternalId: string | null;
    historicalPaidCount: number;
    evidence: "mapped_won_opportunity" | "no_current_payment_proof";
  };
  renewal: {
    state: "proven" | "ambiguous" | "missing";
    basis:
      | "configured_enrolment_field"
      | "single_mapped_won_opportunity"
      | "multiple_mapped_won_opportunities"
      | "no_authoritative_date";
    enrolmentOrPurchaseAt: Date | null;
    nextAccessExpiryAt: Date | null;
    sourceFieldLabel: string | null;
    sourceOpportunityExternalId: string | null;
    evidenceCount: number;
  };
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function commercialOpportunityStatus(raw: unknown) {
  const value = String(object(raw).status || "").trim().toLowerCase();
  return value && value !== "unknown" ? value : null;
}

function stageExternalId(raw: unknown) {
  return String(object(raw).stageExternalId || "").trim();
}

function mappingMatches(
  opportunity: CommercialOpportunity,
  mapping: CommercialStageMapping
) {
  if (
    mapping.connectedSystemId !== opportunity.connectedSystemId ||
    mapping.category !== "won" ||
    mapping.isActive === false
  )
    return false;
  const externalStage = stageExternalId(opportunity.raw);
  if (externalStage && externalStage === mapping.externalStageId) return true;
  return Boolean(
    opportunity.stage &&
      opportunity.stage.trim() === mapping.stageLabel.trim()
  );
}

function mappedWon(
  opportunity: CommercialOpportunity,
  mappings: CommercialStageMapping[]
) {
  return (
    commercialOpportunityStatus(opportunity.raw) === "won" &&
    mappings.some(mapping => mappingMatches(opportunity, mapping))
  );
}

export function parseCommercialDate(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.valueOf()))
    return new Date(value.valueOf());
  const text = String(value ?? "").trim();
  if (!text) return null;
  const uk = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (uk) {
    const date = new Date(
      Date.UTC(Number(uk[3]), Number(uk[2]) - 1, Number(uk[1]))
    );
    return Number.isFinite(date.valueOf()) ? date : null;
  }
  const parsed = new Date(text);
  return Number.isFinite(parsed.valueOf()) ? parsed : null;
}

export function addTwelveCalendarMonths(value: Date) {
  const result = new Date(value.valueOf());
  result.setUTCFullYear(result.getUTCFullYear() + 1);
  return result;
}

function opportunityDate(opportunity: CommercialOpportunity) {
  return opportunity.closeAt ?? opportunity.sourceUpdatedAt ?? null;
}

function opportunityRecency(opportunity: CommercialOpportunity) {
  return (
    opportunity.sourceUpdatedAt?.valueOf() ??
    opportunity.updatedAt?.valueOf() ??
    opportunity.closeAt?.valueOf() ??
    0
  );
}

export function deriveCommercialTruth(input: {
  mappedFields: CommercialMappedField[];
  opportunities: CommercialOpportunity[];
  stageMappings: CommercialStageMapping[];
}): CommercialTruth {
  const ordered = [...input.opportunities].sort(
    (a, b) => opportunityRecency(b) - opportunityRecency(a)
  );
  const latest = ordered[0] ?? null;
  const paid = ordered
    .filter(opportunity => mappedWon(opportunity, input.stageMappings))
    .map(opportunity => ({
      opportunity,
      at: opportunityDate(opportunity),
    }))
    .filter(
      (
        item
      ): item is { opportunity: CommercialOpportunity; at: Date } =>
        Boolean(item.at)
    )
    .sort((a, b) => b.at.valueOf() - a.at.valueOf());

  const latestIsPaid = latest
    ? mappedWon(latest, input.stageMappings) && Boolean(opportunityDate(latest))
    : false;
  const latestPaid = paid[0] ?? null;

  const enrolmentField =
    input.mappedFields.find(
      field => field.purpose?.trim().toLowerCase() === "enrolment"
    ) ?? null;
  const configuredEnrolment = parseCommercialDate(enrolmentField?.value);

  let renewal: CommercialTruth["renewal"];
  if (configuredEnrolment) {
    renewal = {
      state: "proven",
      basis: "configured_enrolment_field",
      enrolmentOrPurchaseAt: configuredEnrolment,
      nextAccessExpiryAt: addTwelveCalendarMonths(configuredEnrolment),
      sourceFieldLabel: enrolmentField?.label ?? null,
      sourceOpportunityExternalId: null,
      evidenceCount: 1,
    };
  } else if (paid.length === 1) {
    renewal = {
      state: "proven",
      basis: "single_mapped_won_opportunity",
      enrolmentOrPurchaseAt: paid[0].at,
      nextAccessExpiryAt: addTwelveCalendarMonths(paid[0].at),
      sourceFieldLabel: null,
      sourceOpportunityExternalId: paid[0].opportunity.externalId,
      evidenceCount: 1,
    };
  } else if (paid.length > 1) {
    renewal = {
      state: "ambiguous",
      basis: "multiple_mapped_won_opportunities",
      enrolmentOrPurchaseAt: null,
      nextAccessExpiryAt: null,
      sourceFieldLabel: null,
      sourceOpportunityExternalId: null,
      evidenceCount: paid.length,
    };
  } else {
    renewal = {
      state: "missing",
      basis: "no_authoritative_date",
      enrolmentOrPurchaseAt: null,
      nextAccessExpiryAt: null,
      sourceFieldLabel: enrolmentField?.label ?? null,
      sourceOpportunityExternalId: null,
      evidenceCount: 0,
    };
  }

  return {
    payment: {
      state: latest ? (latestIsPaid ? "paid" : "not_proven") : "unknown",
      latestOpportunityExternalId: latest?.externalId ?? null,
      latestOpportunityStage: latest?.stage ?? null,
      latestPaidAt: latestPaid?.at ?? null,
      latestPaidOpportunityExternalId:
        latestPaid?.opportunity.externalId ?? null,
      historicalPaidCount: paid.length,
      evidence: latestIsPaid
        ? "mapped_won_opportunity"
        : "no_current_payment_proof",
    },
    renewal,
  };
}
