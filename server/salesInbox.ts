import { and, count, desc, eq, isNull, or, sql } from "drizzle-orm";
import { crmContacts, inboundMessages, organisations } from "../drizzle/schema";
import { getDb } from "./db";
import { memberOnboardingFor, requireOrganisationMembership } from "./organisation";
import { personalOwnerSql } from "./customerData";
import { syncGenieMailboxForUser } from "./genieMailbox";
import { syncDelegatedMailbox } from "./delegatedMailbox";

export async function getSalesInbox(input: {
  userId: number;
  organisationId: number;
  limit?: number;
}) {
  await requireOrganisationMembership(input.userId, input.organisationId);
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const limit = Math.min(100, Math.max(1, input.limit ?? 50));

  const actionableWhere = and(
    eq(inboundMessages.organisationId, input.organisationId),
    eq(inboundMessages.needsAction, true),
    or(
      eq(inboundMessages.mailboxUserId, input.userId),
      and(
        isNull(inboundMessages.mailboxUserId),
        personalOwnerSql(
          input,
          crmContacts.connectedSystemId,
          crmContacts.ownerExternalId
        )
      )
    )
  );
  const joinContact = and(
    eq(crmContacts.organisationId, inboundMessages.organisationId),
    eq(crmContacts.connectedSystemId, inboundMessages.connectedSystemId),
    eq(crmContacts.externalId, inboundMessages.contactExternalId)
  );

  const [rows, countRows] = await Promise.all([
    db
      .select({
        message: inboundMessages,
        contactId: crmContacts.id,
        contactFirstName: crmContacts.firstName,
        contactLastName: crmContacts.lastName,
        contactEmail: crmContacts.email,
        contactPhone: crmContacts.phone,
        contactOwnerExternalId: crmContacts.ownerExternalId,
      })
      .from(inboundMessages)
      .leftJoin(crmContacts, joinContact)
      .where(actionableWhere)
      .orderBy(desc(inboundMessages.receivedAt))
      .limit(limit),
    db
      .select({
        total: count(),
        saleIntent: sql<number>`SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(${inboundMessages.classification}, '$.category')) = 'sale_intent' THEN 1 ELSE 0 END)`,
      })
      .from(inboundMessages)
      .leftJoin(crmContacts, joinContact)
      .where(actionableWhere),
  ]);
  const messages = rows.map(row => ({
    ...row.message,
    contact: row.contactId
      ? {
          id: row.contactId,
          name:
            [row.contactFirstName, row.contactLastName]
              .filter(Boolean)
              .join(" ") || row.contactEmail || row.contactPhone || "Customer",
          email: row.contactEmail,
          phone: row.contactPhone,
        }
      : null,
  }));
  const totals = countRows[0];
  return {
    messages,
    needsActionCount: Number(totals?.total || 0),
    saleIntentCount: Number(totals?.saleIntent || 0),
    newestReceivedAt: messages[0]?.receivedAt ?? null,
  };
}

export async function syncSalesInbox(input: {
  userId: number;
  organisationId: number;
}) {
  await requireOrganisationMembership(input.userId, input.organisationId);
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const row = (
    await db
      .select({ settings: organisations.settings })
      .from(organisations)
      .where(eq(organisations.id, input.organisationId))
      .limit(1)
  )[0];
  const source = memberOnboardingFor(
    (row?.settings as Record<string, unknown>) || {},
    input.userId
  ).emailSource;
  return source === "genie"
    ? syncGenieMailboxForUser(input)
    : syncDelegatedMailbox(input);
}
