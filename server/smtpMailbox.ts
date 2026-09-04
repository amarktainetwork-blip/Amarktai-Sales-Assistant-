import { lookup } from "node:dns/promises";
import { and, eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import {
  contactCommunicationSuppressions,
  userMailboxConnections,
} from "../drizzle/schema";
import { getDb, recordAudit } from "./db";
import { requireOrganisationMembership } from "./organisation";
import {
  decryptConnectionSecret,
  encryptConnectionSecret,
} from "./security/connectionSecrets";
import { isPrivateAddress } from "./security/networkPolicy";

const SMTP_PORTS = new Set([465, 587, 2525]);

type PersonalSmtpSecret = {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
};

export type PersonalSmtpConfiguration = {
  email: string;
  displayName?: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
};

async function dbOrThrow() {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  return db;
}

async function assertSafeSmtpHost(rawHost: string, port: number) {
  const host = rawHost.trim().toLowerCase();
  if (!host || host.length > 253 || !/^[a-z0-9.-]+$/i.test(host) || host.includes(".."))
    throw new Error("Enter a valid public SMTP hostname.");
  if (!SMTP_PORTS.has(port))
    throw new Error("Personal SMTP supports ports 465, 587, or 2525 only.");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  )
    throw new Error("Local or private-network SMTP destinations are not permitted.");
  let records: Array<{ address: string }>;
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("The SMTP hostname could not be resolved.");
  }
  if (!records.length || records.some(record => isPrivateAddress(record.address)))
    throw new Error("The SMTP hostname resolves to a private or unsafe network address.");
  return host;
}

function validateEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("Enter a valid mailbox email address.");
  return email;
}

function safeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function smtpTransport(secret: PersonalSmtpSecret) {
  return nodemailer.createTransport({
    host: secret.host,
    port: secret.port,
    secure: secret.secure,
    auth: { user: secret.username, pass: secret.password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });
}

export async function connectPersonalSmtpMailbox(input: {
  userId: number;
  organisationId: number;
  configuration: PersonalSmtpConfiguration;
}) {
  await requireOrganisationMembership(input.userId, input.organisationId);
  const email = validateEmail(input.configuration.email);
  const port = Number(input.configuration.port);
  if (!Number.isInteger(port)) throw new Error("Enter a valid SMTP port.");
  const host = await assertSafeSmtpHost(input.configuration.host, port);
  const username = input.configuration.username.trim();
  const password = input.configuration.password;
  if (!username || !password)
    throw new Error("SMTP username and password or app password are required.");
  const secret: PersonalSmtpSecret = {
    host,
    port,
    secure: Boolean(input.configuration.secure),
    username,
    password,
  };
  const transporter = smtpTransport(secret);
  await transporter.verify();
  const encrypted = encryptConnectionSecret(secret);
  const db = await dbOrThrow();
  await db
    .insert(userMailboxConnections)
    .values({
      userId: input.userId,
      organisationId: input.organisationId,
      provider: "smtp",
      email,
      displayName: input.configuration.displayName?.trim().slice(0, 220) || email,
      tenantId: null,
      status: "ready",
      scopes: ["smtp.send"],
      ...encrypted,
      expiresAt: null,
    })
    .onDuplicateKeyUpdate({
      set: {
        email,
        displayName:
          input.configuration.displayName?.trim().slice(0, 220) || email,
        status: "ready",
        scopes: ["smtp.send"],
        ...encrypted,
        expiresAt: null,
      },
    });
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "personal_mailbox_connected",
    entityType: "user_mailbox",
    entityId: String(input.userId),
    summary: "The salesperson connected a verified personal SMTP mailbox for outbound email.",
    metadata: { provider: "smtp", email, host, port, passwordStoredInAudit: false },
  });
  return { email, displayName: input.configuration.displayName?.trim() || email };
}

export async function getPersonalSmtpAccess(input: {
  userId: number;
  organisationId: number;
}) {
  await requireOrganisationMembership(input.userId, input.organisationId);
  const db = await dbOrThrow();
  const row = (
    await db
      .select()
      .from(userMailboxConnections)
      .where(
        and(
          eq(userMailboxConnections.userId, input.userId),
          eq(userMailboxConnections.organisationId, input.organisationId),
          eq(userMailboxConnections.provider, "smtp"),
          eq(userMailboxConnections.status, "ready")
        )
      )
      .limit(1)
  )[0];
  if (!row)
    throw new Error("Connect and verify your SMTP mailbox before sending email.");
  return {
    provider: "smtp" as const,
    connectionId: row.id,
    email: row.email,
    scopes: row.scopes,
    secret: decryptConnectionSecret<PersonalSmtpSecret>(row),
  };
}

async function assertEmailNotSuppressed(
  organisationId: number,
  recipient: string,
  contactExternalId?: string
) {
  const db = await dbOrThrow();
  const conditions = [
    eq(contactCommunicationSuppressions.organisationId, organisationId),
    eq(contactCommunicationSuppressions.channel, "email"),
    eq(contactCommunicationSuppressions.senderReference, recipient.toLowerCase()),
  ];
  const blocked = (
    await db
      .select({ id: contactCommunicationSuppressions.id })
      .from(contactCommunicationSuppressions)
      .where(and(...conditions))
      .limit(1)
  )[0];
  if (blocked)
    throw new Error("OUTBOUND_SUPPRESSED: this recipient has opted out.");
  if (contactExternalId) {
    const byContact = (
      await db
        .select({ id: contactCommunicationSuppressions.id })
        .from(contactCommunicationSuppressions)
        .where(
          and(
            eq(contactCommunicationSuppressions.organisationId, organisationId),
            eq(contactCommunicationSuppressions.channel, "email"),
            eq(contactCommunicationSuppressions.contactExternalId, contactExternalId)
          )
        )
        .limit(1)
    )[0];
    if (byContact)
      throw new Error("OUTBOUND_SUPPRESSED: this contact has opted out.");
  }
}

export async function sendPersonalSmtpMail(input: {
  userId: number;
  organisationId: number;
  to: string;
  subject: string;
  body: string;
  reviewReference: string;
  contactExternalId?: string;
}) {
  if (!input.reviewReference.trim())
    throw new Error("An approved review reference is required before sending email.");
  const to = validateEmail(input.to);
  if (!input.subject.trim() || !input.body.trim())
    throw new Error("The email subject and draft body are required.");
  await assertEmailNotSuppressed(input.organisationId, to, input.contactExternalId);
  const mailbox = await getPersonalSmtpAccess(input);
  const transporter = smtpTransport(mailbox.secret);
  const messageId = `<amarktai-${Buffer.from(input.reviewReference.trim())
    .toString("base64url")
    .slice(0, 120)}@amarktai.invalid>`;
  const result = await transporter.sendMail({
    from: mailbox.email,
    to,
    subject: safeHeader(input.subject),
    html: input.body,
    text: input.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    messageId,
    headers: { "X-Amarktai-Review-Reference": safeHeader(input.reviewReference).slice(0, 180) },
  });
  const accepted = (result.accepted || []).map(String);
  const rejected = (result.rejected || []).map(String);
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "personal_mailbox_email_accepted",
    entityType: "user_mailbox",
    entityId: String(input.userId),
    summary: "An approved email was submitted through the salesperson's verified SMTP mailbox.",
    metadata: {
      provider: "smtp",
      messageId: result.messageId || messageId,
      acceptedCount: accepted.length,
      rejectedCount: rejected.length,
      reviewReference: input.reviewReference.trim().slice(0, 180),
    },
  });
  return {
    sent: accepted.length > 0 && rejected.length === 0,
    accepted,
    rejected,
    provider: "smtp_personal" as const,
    from: mailbox.email,
    messageId: result.messageId || messageId,
  };
}
