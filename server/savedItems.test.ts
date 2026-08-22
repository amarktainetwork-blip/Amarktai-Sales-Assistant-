import { describe, expect, it } from "vitest";
import { isSavedItemTargetType, normalizeSavedItemTags } from "./savedItems";

describe("workspace saved items", () => {
  it("normalizes, de-duplicates, bounds, and drops empty tags", () => {
    expect(normalizeSavedItemTags([" Priority ", "priority", "", "follow   up", "x".repeat(80)])).toEqual(["Priority", "priority", "follow up", "x".repeat(48)]);
  });

  it("accepts only supported saved-item references", () => {
    expect(isSavedItemTargetType("action_proposal")).toBe(true);
    expect(isSavedItemTargetType("lead")).toBe(true);
    expect(isSavedItemTargetType("pitch")).toBe(true);
    expect(isSavedItemTargetType("crm_token")).toBe(false);
  });
});
