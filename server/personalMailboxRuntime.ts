import { and, desc, eq } from "drizzle-orm";
import { userMailboxConnections } from "../drizzle/schema";
import { getDb, recordAudit } from "./db";
import { requireOrganisationMembership } from "./organisation";
import {
  createDelegatedOutlookCalendarEvent,
  delegatedMailboxReadiness,
  sendDelegatedOutlookMail,
  syncDelegatedMailbox,
} from "./delegatedMailbox";
import {
  createDelegatedGoogleCalendarEvent,
  googleMailboxReadiness,
  sendDelegatedGoogleMail,
  syncGoogleMailbox,
  waitForGoogleSentMailReadback,
  findGoogleSentMailByReference,
} from "./googleMailbox";
import { sendPersonalSmtpMail } from "./smtpMailbox";
import {
  findDelegatedSentMailByReference,
  waitForDelegatedSentMailReadback,
} from "./delegatedMailboxReadback";

export type PersonalMailboxProvider = "microsoft" | "google" | "smtp";

export type PersonalMailboxCapabilities = {
  sendEmail: boolean;
  inboxSync: boolean;
  calendar: boolean;
  sentReadback: boolean;
};

const labels: Record<PersonalMailboxProvider, string> = {
  microsoft: "Microsoft 365 / Outlook",
  google: "Google / Gmail",
  smtp: "Other email (SMTP)",
};

function providerCapabilities(
  provider: PersonalMailboxProvider,
  scopes: string[]
): PersonalMailboxCapabilities {
  const set = new Set(scopes.map(scope => scope.toLowerCase()));
  if (provider === "microsoft")
    return {
      sendEmail: set.has("mail.send"),
      inboxSync: set.has("mail.read"),
      calendar: set.has("calendars.readwrite"),
      sentReadback: set.has("mail.read") && set.has("mail.send"),
    };
  if (provider === "google")
    return {
      sendEmail: set.has("https://www.googleapis.com/auth/gmail.send"),
      inboxSync: set.has("https://www.googleapis.com/auth/gmail.readonly"),
      calendar: set.has("https://www.googleapis.com/auth/calendar.events"),
      sentReadback:
        set.has("https://www.googleapis.com/auth/gmail.readonly") &&
        set.has("https://www.googleapis.com/auth/gmail.send"),
    };
  return {
    sendEmail: set.has("smtp.send"),
    inboxSync: false,
    calendar: false,
    sentReadback: false,
  };
}

export function personalMailboxProviderAvailability() {
  const microsoft = delegatedMailboxReadiness();
  const google = googleMailboxReadiness();
  return [
    {
      provider: "microsoft" as const,
      label: labels.microsoft,
      configured: microsoft.ready,
      connectionModel: "per_user_delegated_oauth" as const,
      capabilities: {
        sendEmail: true,
        inboxSync: true,
        calendar: true,
        sentReadback: true,
      },
    },
    {
      provider: "google" as const,
      label: labels.google,
      configured: google.ready,
      connectionModel: "per_user_delegated_oauth" as const,
      capabilities: {
        sendEmail: true,
        inboxSync: true,
        calendar: true,
        sentReadback: true,
      },
    },
    {
      provider: "smtp" as const,
      label: labels.smtp,
      configured: true,
      connectionModel: "per_user_verified_smtp" as const,
      capabilities: {
        sendEmail: true,
        inboxSync: false,
        calendar: false,
        sentReadback: false,
      },
    },
  ];
}

async function dbOrThrow() {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  return db;
}

export async function getPersonalMailboxStatus(input: {
  userId: number;
  organisationId: number;
}) {
  await requireOrganisationMembership(input.userId, input.organisationId);
  const db = await dbOrThrow();
  const rows = await db
    .select({
      id: userMailboxConnections.id,
      provider: userMailboxConnections.provider,
      email: userMailboxConnections.email,
      displayName: userMailboxConnections.displayName,
      status: userMailboxConnections.status,
      scopes: userMailboxConnections.scopes,
      lastSyncedAt: userMailboxConnections.lastSyncedAt,
      updatedAt: userMailboxConnections.updatedAt,
    })
    .from(userMailboxConnections)
    .where(
      and(
        eq(userMailboxConnections.userId, input.userId),
        eq(userMailboxConnections.organisationId, input.organisationId)
      )
    )
    .orderBy(desc(userMailboxConnections.updatedAt));
  const connections = rows.map(row => ({
    ...row,
    label: labels[row.provider],
    capabilities: providerCapabilities(row.provider, row.scopes),
  }));
  const active = connections.find(row => row.status === "ready") || null;
  const providers = personalMailboxProviderAvailability().map(provider => ({
    ...provider,
    connected: connections.some(
      row => row.provider === provider.provider && row.status === "ready"
    ),
  }));
  return {
    configured: providers.some(provider => provider.configured),
    connected: Boolean(active),
    mailbox: active,
    connections,
    providers,
  };
}

export async function requirePersonalMailboxProvider(input: {
  userId: number;
  organisationId: number;
  provider?: PersonalMailboxProvider;
  capability?: keyof PersonalMailboxCapabilities;
}) {
  const status = await getPersonalMailboxStatus(input);
  const connection = input.provider
    ? status.connections.find(
        row => row.provider === input.provider && row.status === "ready"
      )
    : status.mailbox;
  if (!connection)
    throw new Error(
      input.provider
        ? `Your ${labels[input.provider]} mailbox is not connected.`
        : "Connect your personal mailbox before using email or calendar."
    );
  if (input.capability && !connection.capabilities[input.capability])
    throw new Error(
      `${connection.label} does not provide ${input.capability === "inboxSync" ? "inbox sync" : input.capability === "calendar" ? "calendar access" : input.capability === "sentReadback" ? "sent-mail readback" : "email sending"} for this connection.`
    );
  return connection;
}

export async function disconnectPersonalMailbox(input: {
  userId: number;
  organisationId: number;
  provider?: PersonalMailboxProvider;
}) {
  await requireOrganisationMembership(input.userId, input.organisationId);
  const db = await dbOrThrow();
  const conditions = [
    eq(userMailboxConnections.userId, input.userId),
    eq(userMailboxConnections.organisationId, input.organisationId),
  ];
  if (input.provider)
    conditions.push(eq(userMailboxConnections.provider, input.provider));
  await db.delete(userMailboxConnections).where(and(...conditions));
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "personal_mailbox_disconnected",
    entityType: "user_mailbox",
    entityId: String(input.userId),
    summary: input.provider
      ? `The salesperson disconnected their ${labels[input.provider]} mailbox.`
      : "The salesperson disconnected their personal mailbox connections.",
    metadata: { provider: input.provider || "all" },
  });
  return { disconnected: true as const };
}

export async function syncPersonalMailbox(input: {
  userId: number;
  organisationId: number;
  provider?: PersonalMailboxProvider;
}) {
  const connection = await requirePersonalMailboxProvider({
    ...input,
    capability: "inboxSync",
  });
  if (connection.provider === "microsoft") return syncDelegatedMailbox(input);
  if (connection.provider === "google") return syncGoogleMailbox(input);
  throw new Error(
    "This SMTP-only connection can send approved email but cannot read the inbox. Connect Microsoft 365 or Google for inbox sync."
  );
}

export async function sendPersonalMailboxMail(input: {
  userId: number;
  organisationId: number;
  provider?: PersonalMailboxProvider;
  to: string;
  subject: string;
  body: string;
  reviewReference: string;
  contactExternalId?: string;
}) {
  const connection = await requirePersonalMailboxProvider({
    userId: input.userId,
    organisationId: input.organisationId,
    provider: input.provider,
    capability: "sendEmail",
  });
  if (connection.provider === "microsoft")
    return sendDelegatedOutlookMail(input);
  if (connection.provider === "google") return sendDelegatedGoogleMail(input);
  return sendPersonalSmtpMail(input);
}

export async function createPersonalMailboxCalendarEvent(input: {
  userId: number;
  organisationId: number;
  provider?: PersonalMailboxProvider;
  subject: string;
  body: string;
  startIso: string;
  endIso: string;
  attendees: string[];
  timezone?: string;
  reviewReference: string;
}) {
  const connection = await requirePersonalMailboxProvider({
    userId: input.userId,
    organisationId: input.organisationId,
    provider: input.provider,
    capability: "calendar",
  });
  if (connection.provider === "microsoft")
    return createDelegatedOutlookCalendarEvent(input);
  if (connection.provider === "google")
    return createDelegatedGoogleCalendarEvent(input);
  throw new Error(
    "SMTP-only connections do not provide calendar access. Connect Microsoft 365 or Google Calendar."
  );
}

export async function findPersonalSentMailByReference(input: {
  userId: number;
  organisationId: number;
  provider: PersonalMailboxProvider;
  reviewReference: string;
}) {
  if (input.provider === "microsoft")
    return findDelegatedSentMailByReference(input);
  if (input.provider === "google") return findGoogleSentMailByReference(input);
  return {
    found: false as const,
    readbackSupported: false as const,
    inspected: 0,
  };
}

export async function waitForPersonalSentMailReadback(input: {
  userId: number;
  organisationId: number;
  provider: PersonalMailboxProvider;
  reviewReference: string;
}) {
  if (input.provider === "microsoft")
    return waitForDelegatedSentMailReadback(input);
  if (input.provider === "google") return waitForGoogleSentMailReadback(input);
  return {
    found: false as const,
    readbackSupported: false as const,
    inspected: 0,
  };
}
