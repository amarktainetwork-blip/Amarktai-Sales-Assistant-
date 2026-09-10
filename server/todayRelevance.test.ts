import { describe, expect, it } from "vitest";
import {
  configuredTaskPriorityTitles,
  isCurrentActionableInbound,
  sortTasksByConfiguredPriority,
} from "./today";

describe("current sales day relevance", () => {
  const now = new Date("2026-09-07T12:00:00.000Z");

  it("surfaces current actionable replies and excludes old mailbox history", () => {
    expect(
      isCurrentActionableInbound(
        {
          needsAction: true,
          receivedAt: new Date("2026-09-06T12:00:00.000Z"),
        },
        now
      )
    ).toBe(true);
    expect(
      isCurrentActionableInbound(
        {
          needsAction: true,
          receivedAt: new Date("2025-09-06T12:00:00.000Z"),
        },
        now
      )
    ).toBe(false);
    expect(
      isCurrentActionableInbound(
        {
          needsAction: false,
          receivedAt: new Date("2026-09-06T12:00:00.000Z"),
        },
        now
      )
    ).toBe(false);
  });

  it("prioritises configured contact-attempt task titles without client-specific constants", () => {
    const titles = configuredTaskPriorityTitles({
      workflows: {
        first_contact: {
          taskAliases: {
            attempt_one: "Initial Contact",
            attempt_two: "Second Contact",
          },
          taskSequence: ["attempt_one", "attempt_two"],
          sequence: [],
          eligibilityStatuses: [],
          stopStatuses: [],
          opportunityMappings: {},
          statusMappings: {},
          templates: {},
          timingRules: {},
          duplicateRules: [],
          requiredPostconditions: [],
        },
      },
      templates: {},
      approvedSenders: {},
      duplicateRules: [],
      closureMapping: {},
      requiredPostconditions: {},
      currentRecordRules: [],
    });
    expect(titles).toEqual(["Initial Contact", "Second Contact"]);
    const sorted = sortTasksByConfiguredPriority(
      [
        { title: "General Admin", dueAt: new Date("2026-09-01T08:00:00Z") },
        { title: "Second Contact", dueAt: new Date("2026-09-02T08:00:00Z") },
        { title: "Initial Contact", dueAt: new Date("2026-09-03T08:00:00Z") },
      ],
      titles
    );
    expect(sorted.map(item => item.title)).toEqual([
      "Initial Contact",
      "Second Contact",
      "General Admin",
    ]);
  });
});
