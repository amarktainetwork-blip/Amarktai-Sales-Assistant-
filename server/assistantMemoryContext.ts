export type AssistantMemoryRecord = {
  subject: string;
  content: string;
  memoryType: string;
  provenance: string;
  trust: string;
  occurredAt?: Date | string | null;
  createdAt?: Date | string | null;
};

function dateValue(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function assistantMemoryWindowLabel(value: Date | string | null | undefined, now = new Date()) {
  const date = dateValue(value);
  if (!date) return "date unknown";
  const today = startOfUtcDay(now);
  const memoryDay = startOfUtcDay(date);
  const days = Math.floor((today.valueOf() - memoryDay.valueOf()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days >= 2 && days <= 7) return "last 7 days";
  if (days >= 8 && days <= 31) return "last 30 days";
  return date.toISOString().slice(0, 10);
}

function queryTerms(query: string) {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .split(/\s+/)
        .filter(term => term.length >= 4)
    )
  ).slice(0, 40);
}

function temporalWindowDays(query: string) {
  const normalized = query.toLowerCase();
  if (/\byesterday\b/.test(normalized)) return 2;
  if (/\blast\s+week\b|\bpast\s+week\b|\bthis\s+week\b/.test(normalized)) return 8;
  if (/\blast\s+month\b|\bpast\s+month\b|\bthis\s+month\b/.test(normalized)) return 35;
  if (/\brecent|previous|before|remember|last time\b/.test(normalized)) return 90;
  return 45;
}

export function selectAssistantMemoryContext(
  query: string,
  records: AssistantMemoryRecord[],
  now = new Date(),
  maximum = 36
) {
  const terms = queryTerms(query);
  const windowDays = temporalWindowDays(query);
  const cutoff = now.valueOf() - windowDays * 86_400_000;

  const ranked = records
    .map(record => {
      const occurred = dateValue(record.occurredAt) || dateValue(record.createdAt);
      const text = `${record.subject} ${record.content}`.toLowerCase();
      const termMatches = terms.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
      const inWindow = !occurred || occurred.valueOf() >= cutoff;
      const recency = occurred ? Math.max(0, 45 - Math.floor((now.valueOf() - occurred.valueOf()) / 86_400_000)) : 0;
      return { record, occurred, score: termMatches * 100 + (inWindow ? 30 : 0) + recency };
    })
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, maximum)
    .sort((left, right) => (right.occurred?.valueOf() || 0) - (left.occurred?.valueOf() || 0));

  return ranked.map(({ record, occurred }) => ({
    when: occurred ? assistantMemoryWindowLabel(occurred, now) : "date unknown",
    date: occurred ? dayKey(occurred) : null,
    subject: record.subject,
    content: record.content,
    memoryType: record.memoryType,
    provenance: record.provenance,
    trust: record.trust,
  }));
}

export function firstNameFromDisplayName(value: string | null | undefined) {
  const cleaned = String(value || "").trim();
  if (!cleaned) return "";
  return cleaned.split(/\s+/)[0].slice(0, 80);
}
