import { and, eq } from "drizzle-orm";
import { crmContacts } from "../drizzle/schema";
import { getDb } from "./db";
import {
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
};

async function contextFromExternalId(input: {
  organisationId: number;
  connectedSystemId: number;
  contactExternalId: string;
  source: ResolvedAssistantCustomerContext["targetVerification"]["source"];
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const rows = await db
    .select({ id: crmContacts.id })
    .from(crmContacts)
    .where(
      and(
        eq(crmContacts.organisationId, input.organisationId),
        eq(crmContacts.connectedSystemId, input.connectedSystemId),
        eq(crmContacts.externalId, input.contactExternalId)
      )
    )
    .limit(2);
  if (rows.length !== 1)
    throw new Error(
      rows.length > 1
        ? "AMBIGUOUS_TARGET: the current CRM external record does not resolve to one normalized customer. Nothing was prepared."
        : "CURRENT_CRM_CUSTOMER_NOT_SYNCED: the exact current CRM record is not available in the normalized customer store yet. Nothing was prepared."
    );
  const context = await getWorkingContextForContact({
    organisationId: input.organisationId,
    contactId: rows[0].id,
  });
  return {
    ...context,
    targetVerification: {
      verified: true as const,
      source: input.source,
      connectedSystemId: context.connectedSystemId,
      contactExternalId: context.contactExternalId,
    },
  };
}

/**
 * Resolves the same canonical normalized customer context for both the full
 * Assistant and the CRM-side Assistant. CRM-viewer identity is accepted only
 * from a stable external record ID or a configured deterministic URL rule;
 * page titles and displayed names are never identity evidence.
 */
export async function resolveAssistantCustomerContext(input: {
  organisationId: number;
  contactId?: number;
  crmContext?: AssistantCrmSurfaceContext;
}): Promise<ResolvedAssistantCustomerContext | null> {
  if (input.contactId) {
    const context = await getWorkingContextForContact({
      organisationId: input.organisationId,
      contactId: input.contactId,
    });
    return {
      ...context,
      targetVerification: {
        verified: true,
        source: "assistant_customer_selector",
        connectedSystemId: context.connectedSystemId,
        contactExternalId: context.contactExternalId,
      },
    };
  }

  const crmContext = input.crmContext;
  if (!crmContext?.connectedSystemId) return null;
  const explicitExternalId = crmContext.currentContactExternalId?.trim();
  if (explicitExternalId)
    return contextFromExternalId({
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
