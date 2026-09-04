import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import {
  actionProposals,
  contactCommunicationSuppressions,
  userMailboxConnections,
  userMailboxOAuthStates,
} from "../drizzle/schema";
import {
  createWorkflowRun,
  getDb,
  recordAudit,
  searchApprovedKnowledge,
} from "./db";
import { requireOrganisationMembership } from "./organisation";
import {
  decryptConnectionSecret,
  encryptConnectionSecret,
} from "./security/connectionSecrets";
import { ingestInboundMessage } from "./communications/inboundPipeline";
import { runGenxAgent } from "./genx";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const CALENDAR_API =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const MAX_INBOX_SYNC_MESSAGES = 100;

export const googleMailboxScopes = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

type GoogleTokens = {
  accessToken: string;
  refreshToken: string;
  scope: string;
};

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

type GmailHeader = { name?: string; value?: string };
type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
};
type GmailMessage = {
  id?: string;
  threadId?: string;
  internalDate?: string;
  payload?: GmailPart;
};
type GmailList = {
  messages?: Array<{ id?: string; threadId?: string }>;
  nextPageToken?: string;
};

function appUrl() {
  return (
    process.env.APP_PUBLIC_URL?.trim() || process.env.PUBLIC_APP_URL?.trim()
  )?.replace(/\/$/, "");
}

export function googleMailboxReadiness() {
  const clientId = process.env.GOOGLE_MAILBOX_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_MAILBOX_CLIENT_SECRET?.trim();
  const redirectUri =
    process.env.GOOGLE_MAILBOX_REDIRECT_URI?.trim() ||
    (appUrl() ? `${appUrl()}/api/mailbox/google/callback` : undefined);
  return {
    ready: Boolean(clientId && clientSecret && redirectUri),
    clientId,
    clientSecret,
    redirectUri,
  };
}

async function dbOrThrow() {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  return db;
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function base64UrlEncode(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function header(part: GmailPart | undefined, name: string) {
  return (part?.headers || []).find(
    item => item.name?.toLowerCase() === name.toLowerCase()
  )?.value;
}

function senderAddress(value?: string) {
  if (!value) return "";
  const angle = value.match(/<([^<>\s]+@[^<>\s]+)>/);
  const candidate = (angle?.[1] || value).trim().replace(/^"|"$/g, "");
  const email = candidate.match(/[^\s<>,;]+@[^\s<>,;]+/)?.[0] || "";
  return email.toLowerCase();
}

function senderName(value?: string) {
  if (!value) return "";
  const angle = value.indexOf("<");
  if (angle <= 0) return "";
  return value.slice(0, angle).trim().replace(/^"|"$/g, "").slice(0, 220);
}

function partText(part?: GmailPart): { plain?: string; html?: string } {
  if (!part) return {};
  const mine: { plain?: string; html?: string } = {};
  if (part.body?.data) {
    if (part.mimeType === "text/plain") mine.plain = base64UrlDecode(part.body.data);
    if (part.mimeType === "text/html") mine.html = base64UrlDecode(part.body.data);
  }
  for (const child of part.parts || []) {
    const nested = partText(child);
    if (!mine.plain && nested.plain) mine.plain = nested.plain;
    if (!mine.html && nested.html) mine.html = nested.html;
  }
  return mine;
}

function plainBody(message: GmailMessage) {
  const body = partText(message.payload);
  return (body.plain || body.html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDraft(value: string) {
  return value
    .replace(/^```(?:html|markdown|text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()
    .slice(0, 20_000);
}

async function googleTokenRequest(body: URLSearchParams, requireRefresh = true) {
  const config = googleMailboxReadiness();
  if (!config.ready)
    throw new Error("Google mailbox authorization is not configured.");
  body.set("client_id", config.clientId!);
  body.set("client_secret", config.clientSecret!);
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error("Google did not complete the mailbox authorization.");
  const token = (await response.json()) as GoogleTokenResponse;
  if (!token.access_token || (requireRefresh && !token.refresh_token))
    throw new Error("Google did not return the required delegated mailbox access.");
  return token;
}

async function googleRequest<T>(
  accessToken: string,
  url: string,
  init?: RequestInit
) {
  const parsed = new URL(url);
  const allowed = new Set([
    "https://gmail.googleapis.com",
    "https://www.googleapis.com",
  ]);
  if (!allowed.has(parsed.origin))
    throw new Error("Google mailbox request attempted an unexpected host.");
  const response = await fetch(parsed, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Google mailbox request failed (${response.status})${detail ? `: ${detail.slice(0, 180)}` : ""}.`
    );
  }
  if (response.status === 202 || response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function createGoogleMailboxAuthorization(input: {
  userId: number;
  organisationId: number;
}) {
  await requireOrganisationMembership(input.userId, input.organisationId);
  const config = googleMailboxReadiness();
  if (!config.ready)
    throw new Error("Personal Google mailbox connection is not configured.");
  const db = await dbOrThrow();
  const nonce = randomBytes(32).toString("base64url");
  await db.insert(userMailboxOAuthStates).values({
    userId: input.userId,
    organisationId: input.organisationId,
    nonce,
    redirectUri: config.redirectUri!,
    provider: "google",
    expiresAt: new Date(Date.now() + 10 * 60_000),
  });
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: config.clientId!,
    response_type: "code",
    redirect_uri: config.redirectUri!,
    scope: googleMailboxScopes.join(" "),
    state: nonce,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent select_account",
  }).toString();
  return url.toString();
}

async function consumeGoogleState(nonce: string) {
  const db = await dbOrThrow();
  const state = (
    await db
      .select()
      .from(userMailboxOAuthStates)
      .where(
        and(
          eq(userMailboxOAuthStates.nonce, nonce),
          eq(userMailboxOAuthStates.provider, "google"),
          isNull(userMailboxOAuthStates.consumedAt),
          gt(userMailboxOAuthStates.expiresAt, new Date())
        )
      )
      .limit(1)
  )[0];
  if (!state)
    throw new Error("This Google connection request expired or was already used.");
  await db
    .update(userMailboxOAuthStates)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(userMailboxOAuthStates.id, state.id),
        isNull(userMailboxOAuthStates.consumedAt)
      )
    );
  return state;
}

export async function completeGoogleMailboxAuthorization(input: {
  userId: number;
  organisationId: number;
  state: string;
  code: string;
}) {
  const state = await consumeGoogleState(input.state);
  if (state.userId !== input.userId || state.organisationId !== input.organisationId)
    throw new Error("This Google connection belongs to another workspace.");
  const token = await googleTokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: state.redirectUri,
    })
  );
  const profile = await googleRequest<{ emailAddress?: string }>(
    token.access_token!,
    `${GMAIL_API}/profile`
  );
  const email = profile.emailAddress?.trim().toLowerCase();
  if (!email) throw new Error("Google did not provide a Gmail mailbox address.");
  const encrypted = encryptConnectionSecret({
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    scope: token.scope || googleMailboxScopes.join(" "),
  });
  const expiresAt = new Date(
    Date.now() + Math.max(60, token.expires_in || 3600) * 1000
  );
  const db = await dbOrThrow();
  await db
    .insert(userMailboxConnections)
    .values({
      userId: input.userId,
      organisationId: input.organisationId,
      provider: "google",
      email,
      displayName: email,
      tenantId: null,
      status: "ready",
      scopes: (token.scope || googleMailboxScopes.join(" ")).split(/\s+/),
      ...encrypted,
      expiresAt,
    })
    .onDuplicateKeyUpdate({
      set: {
        email,
        displayName: email,
        status: "ready",
        scopes: (token.scope || googleMailboxScopes.join(" ")).split(/\s+/),
        ...encrypted,
        expiresAt,
      },
    });
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "personal_mailbox_connected",
    entityType: "user_mailbox",
    entityId: String(input.userId),
    summary: "The salesperson connected their own Google mailbox.",
    metadata: { provider: "google", email },
  });
  return { email, displayName: email };
}

export async function getGoogleMailboxAccess(input: {
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
          eq(userMailboxConnections.provider, "google"),
          eq(userMailboxConnections.status, "ready")
        )
      )
      .limit(1)
  )[0];
  if (!row)
    throw new Error("Connect your Google mailbox before using Gmail or Calendar.");
  const tokens = decryptConnectionSecret<GoogleTokens>(row);
  if (row.expiresAt && row.expiresAt.valueOf() > Date.now() + 60_000)
    return {
      provider: "google" as const,
      accessToken: tokens.accessToken,
      email: row.email,
      connectionId: row.id,
      scopes: row.scopes,
    };
  const token = await googleTokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
    }),
    false
  );
  const encrypted = encryptConnectionSecret({
    accessToken: token.access_token,
    refreshToken: token.refresh_token || tokens.refreshToken,
    scope: token.scope || tokens.scope,
  });
  await db
    .update(userMailboxConnections)
    .set({
      ...encrypted,
      expiresAt: new Date(
        Date.now() + Math.max(60, token.expires_in || 3600) * 1000
      ),
      status: "ready",
    })
    .where(eq(userMailboxConnections.id, row.id));
  return {
    provider: "google" as const,
    accessToken: token.access_token!,
    email: row.email,
    connectionId: row.id,
    scopes: row.scopes,
  };
}

async function assertEmailNotSuppressed(
  organisationId: number,
  recipient: string,
  contactExternalId?: string
) {
  const db = await dbOrThrow();
  const identity = contactExternalId
    ? or(
        eq(contactCommunicationSuppressions.senderReference, recipient.toLowerCase()),
        eq(contactCommunicationSuppressions.contactExternalId, contactExternalId)
      )
    : eq(contactCommunicationSuppressions.senderReference, recipient.toLowerCase());
  const blocked = (
    await db
      .select({ id: contactCommunicationSuppressions.id })
      .from(contactCommunicationSuppressions)
      .where(
        and(
          eq(contactCommunicationSuppressions.organisationId, organisationId),
          eq(contactCommunicationSuppressions.channel, "email"),
          identity
        )
      )
      .limit(1)
  )[0];
  if (blocked)
    throw new Error("OUTBOUND_SUPPRESSED: this recipient has opted out.");
}

export function stableGoogleMessageId(reviewReference: string) {
  const digest = createHash("sha256")
    .update(reviewReference.trim())
    .digest("hex")
    .slice(0, 40);
  return `<amarktai-${digest}@amarktai.invalid>`;
}

function safeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export async function findGoogleSentMailByReference(input: {
  userId: number;
  organisationId: number;
  reviewReference: string;
}) {
  const mailbox = await getGoogleMailboxAccess(input);
  const messageId = stableGoogleMessageId(input.reviewReference);
  const query = new URLSearchParams({
    q: `in:sent rfc822msgid:${messageId}`,
    maxResults: "10",
  });
  const result = await googleRequest<GmailList>(
    mailbox.accessToken,
    `${GMAIL_API}/messages?${query.toString()}`
  );
  const message = result.messages?.[0];
  return message?.id
    ? {
        found: true as const,
        mailbox: mailbox.email,
        messageId: message.id,
        threadId: message.threadId || null,
      }
    : { found: false as const, mailbox: mailbox.email, inspected: 0 };
}

export async function waitForGoogleSentMailReadback(input: {
  userId: number;
  organisationId: number;
  reviewReference: string;
}) {
  for (const delay of [0, 250, 650]) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    const result = await findGoogleSentMailByReference(input);
    if (result.found) return result;
  }
  return findGoogleSentMailByReference(input);
}

export async function sendDelegatedGoogleMail(input: {
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
  const to = input.to.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))
    throw new Error("A valid recipient email is required.");
  if (!input.subject.trim() || !input.body.trim())
    throw new Error("The email subject and draft body are required.");
  await assertEmailNotSuppressed(input.organisationId, to, input.contactExternalId);
  const mailbox = await getGoogleMailboxAccess(input);
  const reviewReference = safeHeader(input.reviewReference).slice(0, 180);
  const raw = [
    `From: ${mailbox.email}`,
    `To: ${safeHeader(to)}`,
    `Subject: ${safeHeader(input.subject)}`,
    `Message-ID: ${stableGoogleMessageId(reviewReference)}`,
    `X-Amarktai-Review-Reference: ${reviewReference}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    input.body,
  ].join("\r\n");
  const result = await googleRequest<{ id?: string; threadId?: string }>(
    mailbox.accessToken,
    `${GMAIL_API}/messages/send`,
    { method: "POST", body: JSON.stringify({ raw: base64UrlEncode(raw) }) }
  );
  return {
    sent: Boolean(result.id),
    provider: "google_delegated" as const,
    from: mailbox.email,
    messageId: result.id || null,
    threadId: result.threadId || null,
  };
}

export async function createDelegatedGoogleCalendarEvent(input: {
  userId: number;
  organisationId: number;
  subject: string;
  body: string;
  startIso: string;
  endIso: string;
  attendees: string[];
  timezone?: string;
  reviewReference: string;
}) {
  if (!input.reviewReference.trim())
    throw new Error("An approved review reference is required before creating a calendar invite.");
  const start = new Date(input.startIso);
  const end = new Date(input.endIso);
  if (!input.subject.trim() || Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || end <= start)
    throw new Error("A valid calendar subject, start and end time are required.");
  const attendees = Array.from(
    new Set(
      input.attendees
        .map(value => value.trim().toLowerCase())
        .filter(value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    )
  );
  if (!attendees.length)
    throw new Error("At least one valid calendar attendee is required.");
  const mailbox = await getGoogleMailboxAccess(input);
  const eventId = createHash("sha256")
    .update(input.reviewReference.trim())
    .digest("hex")
    .slice(0, 32)
    .replace(/[w-z]/g, "a");
  const body = JSON.stringify({
    id: eventId,
    summary: input.subject.trim(),
    description: input.body.trim() || input.subject.trim(),
    start: { dateTime: start.toISOString(), timeZone: input.timezone?.trim() || "UTC" },
    end: { dateTime: end.toISOString(), timeZone: input.timezone?.trim() || "UTC" },
    attendees: attendees.map(email => ({ email })),
    extendedProperties: {
      private: { amarktaiReviewReference: input.reviewReference.trim().slice(0, 180) },
    },
  });
  let result: { id?: string; htmlLink?: string; iCalUID?: string };
  const response = await fetch(`${CALENDAR_API}?sendUpdates=all`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${mailbox.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 409) {
    result = await googleRequest(
      mailbox.accessToken,
      `${CALENDAR_API}/${encodeURIComponent(eventId)}`
    );
  } else {
    if (!response.ok)
      throw new Error(`Google Calendar request failed (${response.status}).`);
    result = (await response.json()) as typeof result;
  }
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "delegated_calendar_event_created",
    entityType: "user_mailbox",
    entityId: String(input.userId),
    summary: "An approved calendar invitation was created from the salesperson's connected Google account.",
    metadata: {
      provider: "google",
      eventId: result.id,
      attendeeCount: attendees.length,
      reviewReference: input.reviewReference.trim().slice(0, 180),
    },
  });
  return {
    created: Boolean(result.id),
    provider: "google_delegated" as const,
    from: mailbox.email,
    eventId: result.id,
    webLink: result.htmlLink,
    iCalUId: result.iCalUID,
  };
}

export async function syncGoogleMailbox(input: {
  userId: number;
  organisationId: number;
}) {
  await requireOrganisationMembership(input.userId, input.organisationId);
  const mailbox = await getGoogleMailboxAccess(input);
  const db = await dbOrThrow();
  const connection = (
    await db
      .select({ lastSyncedAt: userMailboxConnections.lastSyncedAt })
      .from(userMailboxConnections)
      .where(eq(userMailboxConnections.id, mailbox.connectionId))
      .limit(1)
  )[0];
  const syncStartedAt = new Date();
  const since = connection?.lastSyncedAt || new Date(Date.now() - 7 * 86_400_000);
  const after = Math.max(0, Math.floor(since.valueOf() / 1000) - 60);
  let pageToken: string | undefined;
  const ids: Array<{ id: string; threadId?: string }> = [];
  do {
    const query = new URLSearchParams({
      q: `in:inbox after:${after}`,
      maxResults: "25",
    });
    if (pageToken) query.set("pageToken", pageToken);
    const page = await googleRequest<GmailList>(
      mailbox.accessToken,
      `${GMAIL_API}/messages?${query.toString()}`
    );
    for (const item of page.messages || []) {
      if (item.id) ids.push({ id: item.id, threadId: item.threadId });
      if (ids.length >= MAX_INBOX_SYNC_MESSAGES) break;
    }
    pageToken = ids.length >= MAX_INBOX_SYNC_MESSAGES ? undefined : page.nextPageToken;
  } while (pageToken);

  let received = 0;
  let draftsPrepared = 0;
  let newestProcessedAt: Date | undefined;
  for (const item of ids.slice(0, MAX_INBOX_SYNC_MESSAGES)) {
    const message = await googleRequest<GmailMessage>(
      mailbox.accessToken,
      `${GMAIL_API}/messages/${encodeURIComponent(item.id)}?format=full`
    );
    const from = header(message.payload, "From");
    const sender = senderAddress(from);
    const name = senderName(from);
    const subject = header(message.payload, "Subject") || "Customer reply";
    const body = plainBody(message);
    const receivedAt = new Date(Number(message.internalDate || Date.now()));
    if (!message.id || !sender || !body || Number.isNaN(receivedAt.valueOf())) continue;
    if (!newestProcessedAt || receivedAt > newestProcessedAt) newestProcessedAt = receivedAt;
    const ingested = await ingestInboundMessage({
      organisationId: input.organisationId,
      mailboxUserId: input.userId,
      envelope: {
        externalMessageId: `google:${message.id}`,
        channel: "email",
        senderReference: sender,
        subject,
        body,
        receivedAt,
      },
    });
    if (!ingested.duplicate) received += 1;
    if (ingested.duplicate || !ingested.replyEligible) continue;
    const idempotencyKey = `mailbox:${input.userId}:inbound:${ingested.id}:reply`;
    const existingProposal = (
      await db
        .select({ id: actionProposals.id })
        .from(actionProposals)
        .where(
          and(
            eq(actionProposals.userId, input.userId),
            eq(actionProposals.organisationId, input.organisationId),
            eq(actionProposals.idempotencyKey, idempotencyKey)
          )
        )
        .limit(1)
    )[0];
    if (existingProposal) continue;
    const knowledge = await searchApprovedKnowledge(
      input.userId,
      input.organisationId,
      `${subject} ${body}`
    );
    const response = await runGenxAgent({
      agentKey: "communications",
      messages: [
        {
          role: "user",
          content:
            "Draft only the natural reply body for the salesperson to review. Answer the customer's request using only the supplied evidence. Do not invent prices, guarantees, availability, commitments or customer facts. Keep the tone warm, clear and concise. Do not add a subject line or commentary about drafting.\n\n" +
            `From: ${name || sender} <${sender}>\nSubject: ${subject}\nMessage: ${body.slice(0, 12_000)}`,
        },
      ],
      approvedKnowledge: knowledge
        .map(source => `${source.title}\n${source.content || source.sourceUrl || ""}`)
        .join("\n\n"),
      workingContext:
        "This is a review-only draft for a real inbound message. Nothing may be sent during drafting.",
      billing: {
        userId: input.userId,
        organisationId: input.organisationId,
        feature: "personal_mailbox_reply_draft",
        reference: `inbound:${ingested.id}`,
      },
      maxOutputTokens: 700,
    });
    const draftBody = cleanDraft(response.content);
    if (!draftBody || /intelligence is not connected|cannot run safely/i.test(draftBody)) continue;
    await createWorkflowRun({
      userId: input.userId,
      organisationId: input.organisationId,
      workflowKey: "mailbox_inbound_reply",
      leadLabel: name || sender,
      payload: { inboundMessageId: ingested.id, source: "personal_mailbox" },
      verificationSummary:
        "A customer email appears to need a reply. The draft was prepared from the inbound message and approved business knowledge, and still requires the salesperson's decision.",
      actions: [
        {
          actionType: "send_email_template",
          title: `Reply to ${name || sender}`,
          targetLabel: name || sender,
          idempotencyKey,
          payload: {
            reviewRequired: true,
            duplicateProtection:
              "Send this reviewed inbound reply only once from the connected personal mailbox.",
            crmRoute: {
              routable: true,
              provider: "personal_mailbox",
              mailboxProvider: "google",
              displayName: "Your Google mailbox",
              connectionMode: "delegated_oauth",
              requiredCapability: "gmail.send",
            },
            to: sender,
            subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
            body: draftBody,
            why: ingested.classification.reasons.join("; "),
            inboundMessageId: ingested.id,
            contactExternalId: ingested.contactExternalId,
            customer: name || sender,
          },
        },
      ],
    });
    draftsPrepared += 1;
  }

  const watermark = newestProcessedAt
    ? new Date(Math.max(since.valueOf(), newestProcessedAt.valueOf() - 1_000))
    : syncStartedAt;
  await db
    .update(userMailboxConnections)
    .set({ lastSyncedAt: watermark })
    .where(eq(userMailboxConnections.id, mailbox.connectionId));
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "personal_mailbox_synced",
    entityType: "user_mailbox",
    entityId: String(input.userId),
    summary: "The salesperson's delegated Google inbox was checked for replies needing attention.",
    metadata: {
      provider: "google",
      received,
      draftsPrepared,
      messageLimit: MAX_INBOX_SYNC_MESSAGES,
      morePagesPending: Boolean(pageToken),
      watermark: watermark.toISOString(),
    },
  });
  return { received, draftsPrepared, morePagesPending: Boolean(pageToken) };
}
