export function normalizeCrmEmail(value?: string | null) {
  return value?.trim().toLowerCase() || null;
}

/** Comparison-only representation; deliberately never guesses a country code. */
export function normalizeCrmPhone(value?: string | null) {
  const input = value?.trim() || "";
  if (!input) return null;
  const prefixed = input.startsWith("00") ? `+${input.slice(2)}` : input;
  const normalized = `${prefixed.startsWith("+") ? "+" : ""}${prefixed.replace(/\D/g, "")}`;
  return normalized === "+" ? null : normalized || null;
}
