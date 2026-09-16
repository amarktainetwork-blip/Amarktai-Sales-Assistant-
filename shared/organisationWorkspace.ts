export const CUSTOMER_MODELS = [
  "individual_consumer",
  "account_business",
  "hybrid",
] as const;
export type CustomerModel = (typeof CUSTOMER_MODELS)[number];
export type OrganisationWorkspace = {
  id: number;
  name: string;
  timezone: string;
  locale: string;
  currency: string;
  customerModel: CustomerModel;
};
export function customerModelContext(model: CustomerModel) {
  return {
    primaryEntity:
      model === "account_business"
        ? "account"
        : model === "hybrid"
          ? "person_and_account"
          : "person",
    companyOptional: model !== "account_business",
    opportunityOptional: true,
    priorities:
      model === "account_business"
        ? ["account_history", "contact_roles", "opportunities"]
        : ["current_work", "communications", "customer_attributes"],
  };
}
export function getOrganisationTimezone(org: { timezone?: string | null }) {
  const zone = org.timezone || "UTC";
  new Intl.DateTimeFormat("en", { timeZone: zone }).format();
  return zone;
}
export function getOrganisationLocale(org: { locale?: string | null }) {
  return Intl.getCanonicalLocales(org.locale || "en")[0];
}
export function getOrganisationCurrency(org: { currency?: string | null }) {
  const currency = org.currency || "USD";
  if (!/^[A-Z]{3}$/.test(currency))
    throw Error("INVALID_ORGANISATION_CURRENCY");
  return currency;
}
function localParts(date: Date, timeZone: string) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter(p => p.type !== "literal")
      .map(p => [p.type, Number(p.value)])
  );
}
function midnight(y: number, m: number, d: number, zone: string) {
  const target = Date.UTC(y, m - 1, d);
  let value = target;
  for (let i = 0; i < 4; i++) {
    const p = localParts(new Date(value), zone);
    const offset =
      Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - value;
    const next = target - offset;
    if (next === value) break;
    value = next;
  }
  return new Date(value);
}
export function organisationDayBounds(now: Date, timezone: string) {
  const p = localParts(now, timezone);
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  return {
    start: midnight(p.year, p.month, p.day, timezone),
    endExclusive: midnight(
      next.getUTCFullYear(),
      next.getUTCMonth() + 1,
      next.getUTCDate(),
      timezone
    ),
  };
}
export function classifyLocalDueDate(
  dueAt: Date | null,
  now: Date,
  timezone: string
) {
  if (!dueAt) return "unscheduled" as const;
  const { start, endExclusive } = organisationDayBounds(now, timezone);
  return dueAt < start
    ? ("overdue" as const)
    : dueAt < endExclusive
      ? ("due_today" as const)
      : ("future" as const);
}
export function formatOrganisationMoney(
  minor: number,
  org: { locale?: string; currency?: string }
) {
  return new Intl.NumberFormat(getOrganisationLocale(org), {
    style: "currency",
    currency: getOrganisationCurrency(org),
  }).format(minor / 100);
}
export function formatOrganisationDate(
  date: Date,
  org: { locale?: string; timezone?: string }
) {
  return new Intl.DateTimeFormat(getOrganisationLocale(org), {
    timeZone: getOrganisationTimezone(org),
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
