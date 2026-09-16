import { and, count, eq, sql } from "drizzle-orm";
import {
  organisations,
  companyProfiles,
  crmContacts,
  crmCompanies,
  crmOpportunities,
  crmActivities,
  crmTasks,
  inboundMessages,
  connectedSystems,
} from "../drizzle/schema";
import { getDb, recordAudit } from "./db";
import {
  requireOrganisationMembership,
  canManageOrganisationForUser,
} from "./organisation";
import {
  CUSTOMER_MODELS,
  customerModelContext,
  getOrganisationTimezone,
  getOrganisationLocale,
  getOrganisationCurrency,
  type CustomerModel,
} from "../shared/organisationWorkspace";
export type CustomerFieldMapping = {
  sourceFieldId: string;
  label: string;
  kind: "text" | "number" | "boolean" | "date";
  purpose?: string;
};
export function normalizeCustomerFieldMappings(
  value: unknown
): CustomerFieldMapping[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is CustomerFieldMapping =>
      Boolean(
        v &&
          typeof v === "object" &&
          typeof v.sourceFieldId === "string" &&
          typeof v.label === "string" &&
          ["text", "number", "boolean", "date"].includes(v.kind)
      )
    )
    .slice(0, 100);
}
export async function getOrganisationWorkspaceContext(organisationId: number) {
  const db = await getDb();
  if (!db) throw Error("Database connection is unavailable.");
  const [org] = await db
    .select()
    .from(organisations)
    .where(eq(organisations.id, organisationId))
    .limit(1);
  if (!org) throw Error("ORGANISATION_NOT_FOUND");
  const settings = org.settings || {};
  const model = CUSTOMER_MODELS.includes(
    settings.customerModel as CustomerModel
  )
    ? (settings.customerModel as CustomerModel)
    : "hybrid";
  const [profile] = await db
    .select()
    .from(companyProfiles)
    .where(eq(companyProfiles.organisationId, organisationId))
    .limit(1);
  const systems = await db
    .select()
    .from(connectedSystems)
    .where(eq(connectedSystems.organisationId, organisationId));
  const domains = [
    ["contacts", crmContacts, "contacts.read"],
    ["companies", crmCompanies, "companies.read"],
    ["opportunities", crmOpportunities, "opportunities.read"],
    ["activities", crmActivities, "activities.read"],
    ["tasks", crmTasks, "tasks.read"],
    ["communications", inboundMessages, ""],
  ] as const;
  const capabilities = Object.fromEntries(
    await Promise.all(
      domains.map(async ([name, table, capability]) => {
        const [result] = await db
          .select({ total: count() })
          .from(table)
          .where(eq(table.organisationId, organisationId));
        return [
          name,
          {
            liveReadProven:
              Boolean(
                capability &&
                  systems.some(s => s.verifiedCapabilities.includes(capability))
              ) ||
              (name === "communications" && Number(result.total) > 0),
            recordCount: Number(result.total),
            available: Number(result.total) > 0,
          },
        ];
      })
    )
  );
  return {
    organisation: {
      id: org.id,
      name: org.name,
      timezone: getOrganisationTimezone(org),
      locale: getOrganisationLocale(org),
      currency: getOrganisationCurrency(org),
    },
    customerModel: model,
    productContext: customerModelContext(model),
    businessContext: profile
      ? {
          companyName: profile.companyName,
          industry: profile.industry,
          primaryMarket: profile.primaryMarket,
          primarySalesObjective: profile.primarySalesObjective,
          brandVoice: profile.brandVoice,
          salesMotion: profile.salesMotion,
          typicalCustomer: profile.typicalCustomer,
          ...((settings.businessModel as object) || {}),
        }
      : settings.businessModel || {},
    workspaceCapabilities: {
      ...capabilities,
      customFields: {
        available:
          normalizeCustomerFieldMappings(settings.customerFieldMappings)
            .length > 0,
      },
      appointments: { available: false, liveReadProven: false },
    },
    customerFieldMappings: normalizeCustomerFieldMappings(
      settings.customerFieldMappings
    ),
    backlogPolicy: (settings.backlogPolicy || { mode: "all_incomplete" }) as {
      mode: string;
      actionableSince?: string;
    },
  };
}
export async function saveOrganisationWorkspaceConfiguration(input: {
  userId: number;
  organisationId: number;
  name?: string;
  timezone: string;
  locale: string;
  currency: string;
  customerModel: CustomerModel;
  businessModel?: Record<string, string>;
  customerFieldMappings?: CustomerFieldMapping[];
  backlogPolicy?: {
    mode: "all_incomplete" | "since";
    actionableSince?: string;
  };
}) {
  const member = await requireOrganisationMembership(
    input.userId,
    input.organisationId
  );
  if (!(await canManageOrganisationForUser(input.userId, member.role)))
    throw Error("MANAGER_REQUIRED");
  if (!CUSTOMER_MODELS.includes(input.customerModel))
    throw Error("INVALID_CUSTOMER_MODEL");
  const timezone = getOrganisationTimezone(input),
    locale = getOrganisationLocale(input),
    currency = getOrganisationCurrency(input);
  if (
    input.backlogPolicy?.mode === "since" &&
    (!input.backlogPolicy.actionableSince ||
      !Number.isFinite(Date.parse(input.backlogPolicy.actionableSince)))
  )
    throw Error("INVALID_BACKLOG_POLICY");
  const db = await getDb();
  if (!db) throw Error("Database connection is unavailable.");
  await db.transaction(async tx => {
    const [org] = await tx
      .select()
      .from(organisations)
      .where(eq(organisations.id, input.organisationId))
      .for("update");
    if (!org) throw Error("ORGANISATION_NOT_FOUND");
    await tx
      .update(organisations)
      .set({
        ...(input.name?.trim()
          ? { name: input.name.trim().slice(0, 180) }
          : {}),
        timezone,
        locale,
        currency,
        settings: {
          ...org.settings,
          customerModel: input.customerModel,
          ...(input.businessModel
            ? { businessModel: input.businessModel }
            : {}),
          ...(input.customerFieldMappings
            ? {
                customerFieldMappings: normalizeCustomerFieldMappings(
                  input.customerFieldMappings
                ),
              }
            : {}),
          ...(input.backlogPolicy
            ? { backlogPolicy: input.backlogPolicy }
            : {}),
        },
      })
      .where(eq(organisations.id, input.organisationId));
  });
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "organisation_workspace_configured",
    entityType: "organisation",
    entityId: String(input.organisationId),
    summary: "Organisation business model and regional context saved.",
    metadata: {
      customerModel: input.customerModel,
      timezone,
      locale,
      currency,
    },
  });
  return getOrganisationWorkspaceContext(input.organisationId);
}
