import { it, expect } from "vitest";
import {
  organisationDayBounds,
  classifyLocalDueDate,
  formatOrganisationMoney,
  formatOrganisationWorkDueDate,
  customerModelContext,
} from "./organisationWorkspace";
it.each([
  [
    "2026-07-01T12:00:00Z",
    "2026-06-30T23:00:00.000Z",
    "2026-07-01T23:00:00.000Z",
  ],
  [
    "2026-01-01T12:00:00Z",
    "2026-01-01T00:00:00.000Z",
    "2026-01-02T00:00:00.000Z",
  ],
  [
    "2026-03-29T12:00:00Z",
    "2026-03-29T00:00:00.000Z",
    "2026-03-29T23:00:00.000Z",
  ],
  [
    "2026-10-25T12:00:00Z",
    "2026-10-24T23:00:00.000Z",
    "2026-10-26T00:00:00.000Z",
  ],
])("uses London DST for %s", (now, start, end) => {
  const bounds = organisationDayBounds(new Date(now), "Europe/London");
  expect(bounds.start.toISOString()).toBe(start);
  expect(bounds.endExclusive.toISOString()).toBe(end);
});
it("classifies across UTC/local midnight without server-local time", () => {
  const now = new Date("2026-07-01T23:15:00Z");
  expect(
    classifyLocalDueDate(new Date("2026-07-01T23:05:00Z"), now, "Europe/London")
  ).toBe("due_today");
  expect(
    classifyLocalDueDate(new Date("2026-07-01T22:59:00Z"), now, "Europe/London")
  ).toBe("overdue");
});
it("formats GBP with organisation locale", () =>
  expect(
    formatOrganisationMoney(123456, { currency: "GBP", locale: "en-GB" })
  ).toBe("£1,234.56"));

it("does not present date-only UK work as a midnight appointment", () => {
  expect(
    formatOrganisationWorkDueDate(new Date("2026-09-24T23:00:00Z"), {
      locale: "en-GB",
      timezone: "Europe/London",
    })
  ).toBe("25 Sept 2026 · time not set");
  expect(
    formatOrganisationWorkDueDate(new Date("2026-09-25T07:00:00Z"), {
      locale: "en-GB",
      timezone: "Europe/London",
    })
  ).toBe("25 Sept 2026, 08:00");
});
it.each(["individual_consumer", "account_business", "hybrid"] as const)(
  "supports %s with optional opportunities",
  model => expect(customerModelContext(model).opportunityOptional).toBe(true)
);
it("a consumer is valid without a company", () =>
  expect(customerModelContext("individual_consumer").companyOptional).toBe(
    true
  ));
