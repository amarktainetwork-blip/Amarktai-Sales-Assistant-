/** One Genie timestamp contract for all source adapters. */
export function genieSourceTimeMs(value: unknown): number | null {
  const raw = typeof value === "string" ? value.trim() : value;
  if (typeof raw === "number" || (typeof raw === "string" && /^\d{10,13}$/.test(raw))) {
    const n = Number(raw);
    const ms = n >= 1e12 ? n : n >= 1e9 && n < 1e11 ? n * 1000 : Number.NaN;
    return Number.isSafeInteger(ms) && ms > 0 ? ms : null;
  }
  if (typeof raw !== "string" || !raw || /^\d+$/.test(raw)) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function genieSourceRevision(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}
