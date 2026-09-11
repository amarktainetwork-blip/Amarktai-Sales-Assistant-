import { and, desc, eq, inArray } from "drizzle-orm";
import {
  crmOpportunities,
  crmTasks,
  externalUserMappings,
} from "../drizzle/schema";
import { getDb } from "./db";
import {
  findPersonalCrmContact,
  getWorkingContextForContact,
  type LiveCallCrmContext,
} from "./liveCalls/context";
import {
  getClientActionConfiguration,
  resolveConfiguredCurrentContact,
} from "./clientActionConfiguration";

export type AssistantCrmSurfaceContext = {
  connectedSystemId?: number;
  authorisedUrlPath?: string;
  pageTitle?: string;
  provider?: string;
  control?: string;
  currentContactExternalId?: string;
};

export type AssistantOperationalRecordState = {
  openTasks: Array<{
    externalId: string;
    title: string;
    status: string;
    dueAt?: string;
  }>;
  currentActiveTaskExternalId?: string;
  openOpportunities: Array<{
    externalId: string;
    name: string;
    stage?: string;
  }>;
  currentActiveOpportunityExternalId?: string;
  historicalCompletedTaskCount: number;
  historicalClosedOpportunityCount: number;
};

export type ResolvedAssistantCustomerContext = LiveCallCrmContext & {
  targetVerification: {
    verified: true;
    source:
      | "assistant_customer_selector"
      | "crm_current_external_id"
      | "crm_configured_url_rule";
    connectedSystemId: number;
    contactExternalId: string;
  };
  operationalRecordState: AssistantOperationalRecordState;
};

function completedTask(status: string) {
  return /complete|closed|done|cancelled/i.test(status);
}

function closedOpportunity(input: { stage?: string | null; raw?: unknown }) {
  const raw =
    input.raw && typeof input.raw === "object" && !Array.isArray(input.raw)
      ? (input.raw as Record<string, unknown>)
      : {};
  return /closed|lost|won|rejected|not.?interested/i.test(
    `${input.stage || ""} ${String(raw.status || "")}`
  );
}

async function operationalRecordState(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
  contactExternalId: string;
}): Promise<AssistantOperationalRecordState> {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const ownerRows = await db
    .select({ externalUserId: externalUserMappings.externalUserId })
    .from(externalUserMappings)
    .where(
      and(
        eq(externalUserMappings.organisationId, input.organisationId),
        eq(externalUserMappings.connectedSystemId, input.connectedSystemId),
        eq(externalUserMappings.userId, input.userId),
        eq(externalUserMappings.isActive, true)
      )
    )
    .limit(100);
  const ownerIds = ownerRows.map(row => row.externalUserId);
  if (!ownerIds.length)
    throw new Error("The selected CRM customer is not available to this user.");
  const [tasks, opportunities] = await Promise.all([
    db
      .select()
      .from(crmTasks)
      .where(
        and(
          eq(crmTasks.organisationId, input.organisationId),
          eq(crmTasks.connectedSystemId, input.connectedSystemId),
          eq(crmTasks.contactExternalId, input.contactExternalId),
          inArray(crmTasks.ownerExternalId, ownerIds)
        )
      )
      .orderBy(desc(crmTasks.updatedAt))
      .limit(120),
    db
      .select()
      .from(crmOpportunities)
      .where(
        and(
          eq(crmOpportunities.organisationId, input.organisationId),
          eq(crmOpportunities.connectedSystemId, input.connectedSystemId),
          eq(crmOpportunities.contactExternalId, input.contactExternalId),
          inArray(crmOpportunities.ownerExternalId, ownerIds)
        )
      )
      .orderBy(desc(crmOpportunities.updatedAt))
      .limit(120),
  ]);
  const openTasks = tasks
    .filter(task => !completedTask(task.status))
    .map(task => ({
      externalId: task.externalId,
      title: task.title,
      status: task.status,
      dueAt: task.dueAt?.toISOString(),
    }));
  const openOpportunities = opportunities
    .filter(opportunity => !closedOpportunity(opportunity))
    .map(opportunity => ({
      externalId: opportunity.externalId,
      name: opportunity.name,
      stage: opportunity.stage || undefined,
    }));
  return {
    openTasks,
    currentActiveTaskExternalId:
      openTasks.length === 1 ? openTasks[0].externalId : undefined,
    openOpportunities,
    currentActiveOpportunityExternalId:
      openOpportunities.length === 1
        ? openOpportunities[0].externalId
        : undefined,
    historicalCompletedTaskCount: tasks.filter(task => completedTask(task.status))
      .length,
    historicalClosedOpportunityCount: opportunities.filter(closedOpportunity)
      .length,
  };
}

async function decorateContext(input: {
  userId: number;
  organisationId: number;
  context: LiveCallCrmContext;
  source: ResolvedAssistantCustomerContext["targetVerification"]["source"];
}): Promise<ResolvedAssistantCustomerContext> {
  const operational = await operationalRecordState({
    userId: input.userId,
    organisationId: input.organisationId,
    connectedSystemId: input.context.connectedSystemId,
    contactExternalId: input.context.contactExternalId,
  });
  return {
    ...input.context,
    targetVerification: {
      verified: true,
      source: input.source,
      connectedSystemId: input.context.connectedSystemId,
      contactExternalId: input.context.contactExternalId,
    },
    operationalRecordState: operational,
  };
}

async function contextFromExternalId(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
  contactExternalId: string;
  source: ResolvedAssistantCustomerContext["targetVerification"]["source"];
}) {
  const contact = await findPersonalCrmContact({
    userId: input.userId,
    organisationId: input.organisationId,
    connectedSystemId: input.connectedSystemId,
    externalId: input.contactExternalId,
  });
  if (!contact)
    throw new Error(
      "CURRENT_CRM_CUSTOMER_NOT_SYNCED: the exact current CRM record is not available to this user in the normalized customer store yet. Nothing was prepared."
    );
  const context = await getWorkingContextForContact({
    userId: input.userId,
    organisationId: input.organisationId,
    contactId: contact.id,
  });
  return decorateContext({
    userId: input.userId,
    organisationId: input.organisationId,
    context,
    source: input.source,
  });
}

/**
 * Resolves the same canonical normalized customer context for both the full
 * Assistant and the CRM-side Assistant. CRM-viewer identity is accepted only
 * from a stable external record ID or a configured deterministic URL rule;
 * page titles and displayed names are never identity evidence.
 */
export async function resolveAssistantCustomerContext(input: {
  userId: number;
  organisationId: number;
  contactId?: number;
  crmContext?: AssistantCrmSurfaceContext;
}): Promise<ResolvedAssistantCustomerContext | null> {
  if (input.contactId) {
    const context = await getWorkingContextForContact({
      userId: input.userId,
      organisationId: input.organisationId,
      contactId: input.contactId,
    });
    return decorateContext({
      userId: input.userId,
      organisationId: input.organisationId,
      context,
      source: "assistant_customer_selector",
    });
  }

  const crmContext = input.crmContext;
  if (!crmContext?.connectedSystemId) return null;
  const explicitExternalId = crmContext.currentContactExternalId?.trim();
  if (explicitExternalId)
    return contextFromExternalId({
      userId: input.userId,
      organisationId: input.organisationId,
      connectedSystemId: crmContext.connectedSystemId,
      contactExternalId: explicitExternalId,
      source: "crm_current_external_id",
    });

  if (!crmContext.authorisedUrlPath) return null;
  const configuration = await getClientActionConfiguration({
    organisationId: input.organisationId,
  });
  const current = resolveConfiguredCurrentContact({
    authorisedUrl: crmContext.authorisedUrlPath,
    provider: crmContext.provider,
    configuration,
  });
  if (!current) return null;
  return contextFromExternalId({
    userId: input.userId,
    organisationId: input.organisationId,
    connectedSystemId: crmContext.connectedSystemId,
    contactExternalId: current.externalId,
    source: "crm_configured_url_rule",
  });
}

export function requestUsesCurrentCustomerReference(value: string) {
  return /\b(?:this|current)\s+(?:customer|contact|candidate|lead|person)\b|\b(?:email|text|sms|whatsapp|message|call|follow up with|add (?:a )?note (?:for|to))\s+(?:them|him|her)\b/i.test(
    value
  );
}
