import { describe, expect, it } from "vitest";
import {
  contactPreferenceEligibility,
  deriveCustomerContactPreference,
  parseContactPreference,
} from "./contactPreference";

describe("customer contact preference", () => {
  it("uses the explicitly mapped CRM contact-preference field", () => {
    expect(
      deriveCustomerContactPreference({
        mappings: [
          {
            sourceFieldId: "best-time",
            label: "Best Time to Call",
            purpose: "contact_preference",
          },
        ],
        attributes: {
          customFields: { "best-time": "Evening" },
          customFieldLabels: { "best-time": "Best Time to Call" },
        },
      })
    ).toBe("Evening");
  });

  it("falls back to a semantic CRM label when a provider has no explicit mapping", () => {
    expect(
      deriveCustomerContactPreference({
        mappings: [],
        attributes: {
          customFields: { custom_17: "Afternoon" },
          customFieldLabels: { custom_17: "Preferred contact time" },
        },
      })
    ).toBe("Afternoon");
  });

  it("understands common dayparts and explicit call windows", () => {
    expect(parseContactPreference("Morning")).toMatchObject({
      label: "morning",
      startMinute: 480,
      endMinute: 720,
    });
    expect(parseContactPreference("Afternoon")).toMatchObject({
      label: "afternoon",
      startMinute: 720,
      endMinute: 1020,
    });
    expect(parseContactPreference("Evening")).toMatchObject({
      label: "evening",
      startMinute: 1020,
      endMinute: 1260,
    });
    expect(parseContactPreference("after 5pm")).toMatchObject({
      label: "after 5pm",
      startMinute: 1020,
      endMinute: null,
    });
    expect(parseContactPreference("9am to 11:30am")).toMatchObject({
      startMinute: 540,
      endMinute: 690,
    });
  });

  it("evaluates eligibility in the organisation timezone", () => {
    const morning = new Date("2026-09-28T08:00:00.000Z"); // 09:00 Europe/London
    const evening = new Date("2026-09-28T17:30:00.000Z"); // 18:30 Europe/London
    expect(
      contactPreferenceEligibility({
        preference: "Evening",
        now: morning,
        timezone: "Europe/London",
      })
    ).toMatchObject({
      eligibleNow: false,
      state: "later_today",
      sortMinute: 1020,
    });
    expect(
      contactPreferenceEligibility({
        preference: "Evening",
        now: evening,
        timezone: "Europe/London",
      })
    ).toMatchObject({ eligibleNow: true, state: "in_window" });
  });
});
