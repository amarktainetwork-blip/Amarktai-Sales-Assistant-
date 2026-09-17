import type { CustomerFieldMapping } from "./organisationWorkspace";

export type CustomerInterestAttributes = {
  tags?: string[];
  customFields?: Record<string, unknown>;
  customFieldLabels?: Record<string, string>;
};

export type DerivedCustomerInterest = {
  primary: string | null;
  values: string[];
  source: "mapped_field" | "form_field" | "tag" | null;
  courseTags: string[];
  tags: string[];
};

function strings(value: unknown): string[] {
  if (typeof value === "string")
    return value
      .split(/\s*[|;]\s*/)
      .map(item => item.trim())
      .filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value === "number" || typeof value === "boolean")
    return [String(value)];
  return [];
}
function unique(values: string[]) {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));
}

function courseFromTag(tag: string) {
  const normalized = tag.trim();
  const prefixed = normalized.match(/^course\s*[—–-]\s*(.+)$/i);
  if (prefixed?.[1]?.trim()) return prefixed[1].trim();

  const landing = normalized.match(/^(.+?)\s+landing\s+page$/i);
  if (!landing?.[1]?.trim()) return null;
  const topic = landing[1].trim();
  if (
    /\b(meta|facebook|fb|google|campaign|black friday|lead|test|finance|payment|sold|remarketing|retarget)\b/i.test(
      topic
    )
  )
    return null;
  return topic;
}

function mappingLooksLikeInterest(mapping: CustomerFieldMapping) {
  if (mapping.purpose?.trim().toLowerCase() === "interest") return true;
  const label = mapping.label.trim();
  return (
    /\b(courses?|programmes?|programs?|qualifications?)\b.*\b(interest|interested|enquiry|inquiry)\b/i.test(
      label
    ) ||
    /\b(interest|interested|enquiry|inquiry)\b.*\b(courses?|programmes?|programs?|qualifications?)\b/i.test(
      label
    )
  );
}
function labelLooksLikeProgrammeForm(label: string) {
  // A generic form identifier is acquisition metadata, not a programme answer.
  return (
    /\b(?:course|programme|program|qualification)\b/i.test(label) &&
    /\bform\b/i.test(label) &&
    !/\b(?:timeframe|start|working|experience|date|time)\b/i.test(label)
  );
}

export function deriveCustomerInterest(input: {
  mappings: CustomerFieldMapping[];
  attributes: CustomerInterestAttributes;
}): DerivedCustomerInterest {
  const customFields = input.attributes.customFields || {};
  const labels = input.attributes.customFieldLabels || {};
  const tags = unique(input.attributes.tags || []);

  const mapped = unique(
    input.mappings
      .filter(mappingLooksLikeInterest)
      .flatMap(mapping => strings(customFields[mapping.sourceFieldId]))
  );

  const mappedIds = new Set(
    input.mappings.map(mapping => mapping.sourceFieldId)
  );
  const mappedForms = input.mappings
    .filter(mapping => labelLooksLikeProgrammeForm(mapping.label))
    .flatMap(mapping => strings(customFields[mapping.sourceFieldId]));
  const labelledForms = Object.entries(customFields)
    .filter(
      ([id]) =>
        !mappedIds.has(id) && labelLooksLikeProgrammeForm(labels[id] || "")
    )
    .flatMap(([, value]) => strings(value));
  const formValues = unique([...mappedForms, ...labelledForms]);

  const courseTags = unique(
    tags.map(courseFromTag).filter((value): value is string => Boolean(value))
  );
  const values = unique([...mapped, ...formValues, ...courseTags]);
  const source = mapped.length
    ? "mapped_field"
    : formValues.length
      ? "form_field"
      : courseTags.length
        ? "tag"
        : null;

  return {
    primary: values[0] || null,
    values,
    source,
    courseTags,
    tags,
  };
}
