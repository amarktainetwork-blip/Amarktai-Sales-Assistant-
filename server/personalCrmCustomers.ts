import { and, eq } from "drizzle-orm";
import { crmContacts, externalUserMappings } from "../drizzle/schema";
import { getDb, listCrmCustomers } from "./db";

/** Personal Customers/Assistant data is always scoped to the signed-in CRM owner mapping. */
export async function listPersonalCrmCustomers(input: {
  userId: number;
  organisationId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");

  const owned = await db
    .select({
      connectedSystemId: crmContacts.connectedSystemId,
      externalId: crmContacts.externalId,
    })
    .from(crmContacts)
    .innerJoin(
      externalUserMappings,
      and(
        eq(externalUserMappings.organisationId, input.organisationId),
        eq(
          externalUserMappings.connectedSystemId,
          crmContacts.connectedSystemId
        ),
        eq(externalUserMappings.externalUserId, crmContacts.ownerExternalId),
        eq(externalUserMappings.userId, input.userId),
        eq(externalUserMappings.isActive, true)
      )
    )
    .where(eq(crmContacts.organisationId, input.organisationId));

  if (!owned.length) return [];
  const allowed = new Set(
    owned.map(contact => `${contact.connectedSystemId}:${contact.externalId}`)
  );
  const customers = await listCrmCustomers(input.organisationId);
  return customers.filter(customer =>
    allowed.has(`${customer.connectedSystemId}:${customer.externalId}`)
  );
}
