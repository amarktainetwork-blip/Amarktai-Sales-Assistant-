export type ContactPreferenceFieldMapping = {
  sourceFieldId: string;
  label: string;
  purpose?: string;
};

export type ContactPreferenceAttributes = {
  customFields: Record<string, unknown>;
  customFieldLabels: Record<string, unknown>;
};

export type ContactPreferenceWindow = {
  raw: string;
  label: string;
  startMinute: number | null;
  endMinute: number | null;
};

function textValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value))
    return value
      .filter(
        (item): item is string | number | boolean =>
          typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean"
      )
      .map(item => String(item).trim())
      .filter(Boolean)
      .join(", ");
  return "";
}

function preferenceFieldIds(input: {
  mappings: ContactPreferenceFieldMapping[];
  attributes: ContactPreferenceAttributes;
}) {
  const explicit = input.mappings
    .filter(
      mapping =>
        mapping.purpose === "contact_preference" ||
        /(?:best|preferred?).*(?:call|contact|time)|(?:call|contact).*(?:best|preferred?|time)/i.test(
          mapping.label
        )
    )
    .map(mapping => mapping.sourceFieldId);
  if (explicit.length) return explicit;
  return Object.entries(input.attributes.customFieldLabels)
    .filter(([, label]) =>
      /(?:best|preferred?).*(?:call|contact|time)|(?:call|contact).*(?:best|preferred?|time)/i.test(
        textValue(label)
      )
    )
    .map(([fieldId]) => fieldId);
}

export function deriveCustomerContactPreference(input: {
  mappings: ContactPreferenceFieldMapping[];
  attributes: ContactPreferenceAttributes;
}) {
  for (const fieldId of preferenceFieldIds(input)) {
    const value = textValue(input.attributes.customFields[fieldId]);
    if (value) return value;
  }
  return null;
}

function parseClock(value: string): number | null {
  const match = value
    .trim()
    .toLowerCase()
    .match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3];
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute > 59)
    return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "pm" && hour !== 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  } else if (hour > 23) return null;
  return hour * 60 + minute;
}

function clockLabel(minute: number) {
  const hour24 = Math.floor(minute / 60) % 24;
  const minutes = minute % 60;
  const suffix = hour24 >= 12 ? "pm" : "am";
  const hour12 = hour24 % 12 || 12;
  return minutes
    ? `${hour12}:${String(minutes).padStart(2, "0")}${suffix}`
    : `${hour12}${suffix}`;
}

export function parseContactPreference(
  value: string | null | undefined
): ContactPreferenceWindow | null {
  const raw = value?.trim();
  if (!raw) return null;
  const normalized = raw
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (/^(?:any|anytime|any time|no preference|n\/a|none)$/i.test(normalized))
    return null;

  const range = normalized.match(
    /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|to|until)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i
  );
  if (range) {
    const startMinute = parseClock(range[1]);
    const endMinute = parseClock(range[2]);
    if (
      startMinute !== null &&
      endMinute !== null &&
      endMinute > startMinute
    )
      return {
        raw,
        label: `${clockLabel(startMinute)}–${clockLabel(endMinute)}`,
        startMinute,
        endMinute,
      };
  }

  const after = normalized.match(
    /\b(?:after|from)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i
  );
  if (after) {
    const startMinute = parseClock(after[1]);
    if (startMinute !== null)
      return {
        raw,
        label: `after ${clockLabel(startMinute)}`,
        startMinute,
        endMinute: null,
      };
  }

  const before = normalized.match(
    /\b(?:before|until)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i
  );
  if (before) {
    const endMinute = parseClock(before[1]);
    if (endMinute !== null)
      return {
        raw,
        label: `before ${clockLabel(endMinute)}`,
        startMinute: null,
        endMinute,
      };
  }

  if (/\bmorning\b/.test(normalized))
    return { raw, label: "morning", startMinute: 8 * 60, endMinute: 12 * 60 };
  if (/\b(?:lunch|lunchtime|midday|noon)\b/.test(normalized))
    return { raw, label: "lunchtime", startMinute: 12 * 60, endMinute: 14 * 60 };
  if (/\bafternoon\b/.test(normalized))
    return { raw, label: "afternoon", startMinute: 12 * 60, endMinute: 17 * 60 };
  if (/\b(?:evening|after work)\b/.test(normalized))
    return { raw, label: "evening", startMinute: 17 * 60, endMinute: 21 * 60 };

  const exact = normalized.match(
    /\b(?:around|at)?\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i
  );
  if (exact) {
    const startMinute = parseClock(exact[1]);
    if (startMinute !== null)
      return {
        raw,
        label: `around ${clockLabel(startMinute)}`,
        startMinute: Math.max(0, startMinute - 30),
        endMinute: Math.min(24 * 60, startMinute + 90),
      };
  }
  return { raw, label: raw, startMinute: null, endMinute: null };
}

export function localMinuteOfDay(now: Date, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const hour = Number(parts.find(part => part.type === "hour")?.value);
    const minute = Number(parts.find(part => part.type === "minute")?.value);
    if (Number.isFinite(hour) && Number.isFinite(minute))
      return hour * 60 + minute;
  } catch {
    // Fall through to the server-local clock only when the organisation
    // timezone itself cannot be formatted.
  }
  return now.getHours() * 60 + now.getMinutes();
}

export function contactPreferenceEligibility(input: {
  preference: string | null | undefined;
  now: Date;
  timezone: string;
}) {
  const window = parseContactPreference(input.preference);
  if (!window)
    return {
      preference: null,
      eligibleNow: true,
      state: "none" as const,
      sortMinute: 0,
    };
  const minute = localMinuteOfDay(input.now, input.timezone);
  if (window.startMinute !== null && minute < window.startMinute)
    return {
      preference: window,
      eligibleNow: false,
      state: "later_today" as const,
      sortMinute: window.startMinute,
    };
  if (window.endMinute !== null && minute >= window.endMinute)
    return {
      preference: window,
      eligibleNow: false,
      state: "window_passed" as const,
      sortMinute: window.endMinute,
    };
  return {
    preference: window,
    eligibleNow: true,
    state: "in_window" as const,
    sortMinute: window.startMinute ?? 0,
  };
}
