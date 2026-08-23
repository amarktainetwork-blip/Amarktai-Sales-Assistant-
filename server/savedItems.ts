export type SavedItemTargetType = "action_proposal" | "lead" | "pitch";

export function normalizeSavedItemTags(tags: string[]) {
  return Array.from(new Set(tags.map(tag => tag.trim().replace(/\s+/g, " ").slice(0, 48)).filter(Boolean))).slice(0, 12);
}

export function isSavedItemTargetType(value: string): value is SavedItemTargetType {
  return value === "action_proposal" || value === "lead" || value === "pitch";
}
