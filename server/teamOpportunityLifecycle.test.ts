import { describe, expect, it } from "vitest";
import { teamOpportunityLifecycle } from "./teamOpportunityLifecycle";
const lifecycle = (
  stage: string | null,
  status: string,
  mappedCategory?: string
) =>
  teamOpportunityLifecycle({
    stage,
    raw: { status },
    closeAt: status === "won" ? new Date("2026-09-24T12:00:00Z") : null,
    mappedCategory,
  });

describe("manager opportunity lifecycle uses Today and Won source truth", () => {
  it.each([
    ["Lost – No Show / No Response", "lost"],
    ["Lost – No Show / No Response", "open"],
    ["Not a Fit / Rejected", "lost"],
    ["Attempting Contact", "lost"],
    ["Discovery Completed – Considering Options", "won"],
  ])(
    "excludes historical stage %s with source status %s from risk",
    (stage, status) => {
      expect(lifecycle(stage, status).isClosed).toBe(true);
    }
  );
  it("does not count an explicitly open/lost item in a Won-labelled stage as a sale", () => {
    expect(lifecycle("Closed Won", "open")).toEqual({
      isWon: false,
      isClosed: true,
    });
    expect(lifecycle("Closed Won", "lost", "won")).toEqual({
      isWon: false,
      isClosed: true,
    });
  });
  it("counts an actual closed sale as Won and excludes it from active risk", () => {
    expect(lifecycle("Closed Won", "won", "won")).toEqual({
      isWon: true,
      isClosed: true,
    });
  });
  it("keeps genuinely open opportunities actionable", () => {
    expect(lifecycle("Attempting Contact", "open")).toEqual({
      isWon: false,
      isClosed: false,
    });
  });
  it("retains explicitly mapped Lost and unclassified older sources", () => {
    expect(lifecycle("Custom Terminal Stage", "open", "lost").isClosed).toBe(
      true
    );
    expect(
      teamOpportunityLifecycle({
        stage: "Custom Won Stage",
        raw: {},
        closeAt: null,
        mappedCategory: "won",
      })
    ).toEqual({ isWon: true, isClosed: true });
  });
  it("does not infer a source-confirmed sale without an authoritative close date", () => {
    expect(
      teamOpportunityLifecycle({
        stage: "Attempting Contact",
        raw: { status: "won" },
        closeAt: null,
      })
    ).toEqual({ isWon: false, isClosed: true });
  });
});
