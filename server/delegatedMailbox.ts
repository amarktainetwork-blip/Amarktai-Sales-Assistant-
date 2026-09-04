import { randomBytes } from "node:crypto";
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

const delegatedScopes = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Mail.Read",
  "Mail.Send",
  "Calendars.ReadWrite",
];

const MAX_INBOX_SYNC_MESSAGES = 100;

type DelegatedTokens = {
  accessToken: string;
  refreshToken: string;
  scope: string;
};

export function delegatedMailboxReadiness() {
  const tenantId = process.env.OUTLOOK_DELEGATED_TENANT_ID?.trim();
  const clientId = process.env.OUTLOOK_DELEGATED_CLIENT_ID?.trim();
  const clientSecret = process.env.OUTLOOK_DELEGATED_CLIENT_SECRET?.trim();
  const appUrl = (
    process.env.APP_PUBLIC_URL?.trim() || process.env.PUBLIC_APP_URL?.trim()
  )?.replace(/\/$/, "");
  const redirectUri =
    process.env.OUTLOOK_DELEGATED_REDIRECT_URI?.trim() ||
    (appUrl ? `${appUrl}/api/mailbox/microsoft/callback` : undefined);
  return {
    ready: Boolean(tenantId && clientId && clientSecret && redirectUri),
    tenantId,
    clientId,
    clientSecret,
    redirectUri,
  };
}

export function mailboxOwnershipMatches(
  record: { userId: number; organisationId: number },
  userId: number,
  organisationId: number
) {
  return record.userId === userId && record.organisationId === organisationId;
}

async function dbOrThrow() {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  return db;
}

export async function createDelegatedMailboxAuthorization(input: {
  userId: number;
  organisationId: number;
}) {
  await requireOrganisationMembership(input.userId, input.organisationId);
  const config = delegatedMailboxReadiness();
  if (!config.ready)
    throw new Error("Personal Microsoft mailbox connection is not configured.");
  const db = await dbOrThrow();
  const nonce = randomBytes(32).toString("base64url");
  await db.insert(userMailboxOAuthStates).values({
    userId: input.userId,
    organisationId: input.organisationId,
    nonce,
    redirectUri: config.redirectUri!,
    provider: "microsoft",
    expiresAt: new Date(Date.now() + 10 * 60_000),
  });
  const url = new URL(
    `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId!)}/oauth2/v2.0/authorize`
  );
  url.search = new URLSearchParams({
    client_id: config.clientId!,
    response_type: "code",
    redirect_uri: config.redirectUri!,
    response_mode: "query",
    scope: delegatedScopes.join(" "),
    state: nonce,
    prompt: "select_account",
  }).toString();
  return url.toString();
}

async function consumeMailboxState(nonce: string) {
  const db = await dbOrThrow();
  const state = (
    await db
      .select()
      .from(userMailboxOAuthStates)
      .where(
        and(
          eq(userMailboxOAuthStates.nonce, nonce),
          eq(userMailboxOAuthStates.provider, "microsoft"),
          isNull(userMailboxOAuthStates.consumedAt),
          gt(userMailboxOAuthStates.expiresAt, new Date())
        )
      )
      .limit(1)
  )[0];
  if (!state)
    throw new Error(
      "This Microsoft connection request expired or was already used."
    );
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

async function tokenRequest(body: URLSearchParams, requireRefresh = true) {
  const config = delegatedMailboxReadiness();
  if (!config.ready)
    throw new Error("Microsoft mailbox authorization is unavailable.");
  body.set("client_id", config.clientId!);
  body.set("client_secret", config.clientSecret!);
  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId!)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(15_000),
    }
  );
  if (!response.ok)
    throw new Error("Microsoft did not complete the mailbox authorization.");
  const result = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!result.access_token || (requireRefresh && !result.refresh_token))
    throw new Error("Microsoft did not return delegated mailbox access.");
  return result;
}

export function microsoftGraphUrl(pathOrUrl: string) {
  if (/^https:\/\//i.test(pathOrUrl)) {
    const url = new URL(pathOrUrl);
    if (
      url.origin !== "https://graph.microsoft.com" ||
      !url.pathname.startsWith("/v1.0/")
    )
      throw new Error("Microsoft paging returned an unexpected host.");
    return url.toString();
  }
  if (!pathOrUrl.startsWith("/"))
    throw new Error("Microsoft mailbox request path is invalid.");
  return `https://graph.microsoft.com/v1.0${pathOrUrl}`;
}

export async function delegatedMicrosoftGraphRequest<T>(
  accessToken: string,
  pathOrUrl: string,
  init?: RequestInit
) {
  const response = await fetch(microsoftGraphUrl(pathOrUrl), {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`Microsoft mailbox request failed (${response.status}).`);
  if (response.status === 202 || response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function completeDelegatedMailboxAuthorization(input: {
  userId: number;
  organisationId: number;
  state: string;
  code: string;
}) {
  const state = await consumeMailboxState(input.state);
  if (!mailboxOwnershipMatches(state, input.userId, input.organisationId))
    throw new Error("This Microsoft connection belongs to another workspace.");
  const token = await tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: state.redirectUri,
      scope: delegatedScopes.join(" "),
    })
  );
  const me = await delegatedMicrosoftGraphRequest<{
    mail?: string;
    userPrincipalName?: string;
    displayName?: string;
    id?: string;
  }>(token.access_token!, "/me?$select=id,displayName,mail,userPrincipalName");
  const email = me.mail || me.userPrincipalName;
  if (!email) throw new Error("Microsoft did not provide a mailbox address.");
  const encrypted = encryptConnectionSecret({
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    scope: token.scope || delegatedScopes.join(" "),
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
      provider: "microsoft",
      email: email.toLowerCase(),
      displayName: me.displayName,
      tenantId: delegatedMailboxReadiness().tenantId,
      status: "ready",
      scopes: (token.scope || delegatedScopes.join(" ")).split(/\s+/),
      ...encrypted,
      expiresAt,
    })
    .onDuplicateKeyUpdate({
      set: {
        email: email.toLowerCase(),
        displayName: me.displayName,
        status: "ready",
        scopes: (token.scope || delegatedScopes.join(" ")).split(/\s+/),
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
    summary: "The salesperson connected their own Microsoft mailbox.",
    metadata: { provider: "microsoft", email: email.toLowerCase() },
  });
  return { email: email.toLowerCase(), displayName: me.displayName || null };
}

export async function getDelegatedMailboxStatus(input: {
  userId: number;
  organisationId: number;
}) {
  await requireOrganisationMembership(input.userId, input.organisationId);
  const db = await dbOrThrow();
  const row = (
    await db
      .select({
        email: userMailboxConnections.email,
        displayName: userMailboxConnections.displayName,
        status: userMailboxConnections.status,
        scopes: userMailboxConnections.scopes,
        updatedAt: userMailboxConnections.updatedAt,
      })
      .from(userMailboxConnections)
      .where(
        and(
          eq(userMailboxConnections.userId, input.userId),
          eq(userMailboxConnections.organisationId, input.organisationId),
          eq(userMailboxConnections.provider, "microsoft")
        )
      )
      .limit(1)
  )[0];
  return {
    configured: delegatedMailboxReadiness().ready,
    connected: row?.status === "ready",
    mailbox: row ?? null,
  };
}

export async function getDelegatedMailboxAccess(input: {
  userId: number;
  organisationId: number;
}) {
  const db = await dbOrThrow();
  const row = (
    await db
      .select()
      .from(userMailboxConnections)
      .where(
        and(
          eq(userMailboxConnections.userId, input.userId),
          eq(userMailboxConnections.organisationId, input.organisationId),
          eq(userMailboxConnections.provider, "microsoft"),
          eq(userMailboxConnections.status, "ready")
        )
      )
      .limit(1)
  )[0];
  if (!row)
    throw new Error(
      "Connect your Microsoft mailbox before using email or calendar."
    );
  const tokens = decryptConnectionSecret<DelegatedTokens>(row);
  if (row.expiresAt && row.expiresAt.valueOf() > Date.now() + 60_000)
    return {
      accessToken: tokens.accessToken,
      email: row.email,
      connectionId: row.id,
    };
  const token = await tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
      scope: delegatedScopes.join(" "),
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
    accessToken: token.access_token!,
    email: row.email,
    connectionId: row.id,
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
        eq(
          contactCommunicationSuppressions.senderReference,
          recipient.toLowerCase()
        ),
        eq(
          contactCommunicationSuppressions.contactExternalId,
          contactExternalId
        )
      )
    : eq(
        contactCommunicationSuppressions.senderReference,
        recipient.toLowerCase()
      );
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

/** Sends only after the existing proposal/review boundary supplies its reference. */
export async function sendDelegatedOutlookMail(input: {
  userId: number;
  organisationId: number;
  to: string;
  subject: string;
  body: string;
  reviewReference: string;
  contactExternalId?: string;
}) {
  if (!input.reviewReference.trim())
    throw new Error(
      "An approved review reference is required before sending email."
    );
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.to.trim()))
    throw new Error("A valid recipient email is required.");
  if (!input.subject.trim() || !input.body.trim())
    throw new Error("The email subject and draft body are required.");
  await assertEmailNotSuppressed(
    input.organisationId,
    input.to.trim(),
    input.contactExternalId
  );
  const mailbox = await getDelegatedMailboxAccess(input);
  await delegatedMicrosoftGraphRequest<void>(
    mailbox.accessToken,
    "/me/sendMail",
    {
      method: "POST",
      body: JSON.stringify({
        message: {
          subject: input.subject.trim(),
          body: { contentType: "HTML", content: input.body },
          toRecipients: [
            { emailAddress: { address: input.to.trim().toLowerCase() } },
          ],
          internetMessageHeaders: [
            {
              name: "X-Amarktai-Review-Reference",
              value: input.reviewReference.trim().slice(0, 180),
            },
          ],
        },
        saveToSentItems: true,
      }),
    }
  );
  return {
    sent: true as const,
    provider: "microsoft_delegated" as const,
    from: mailbox.email,
  };
}

/** Creates an approved calendar invitation from the same user-owned Microsoft connection. */
export async function createDelegatedOutlookCalendarEvent(input: {
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
    throw new Error(
      "An approved review reference is required before creating a calendar invite."
    );
  if (!input.subject.trim()) throw new Error("A calendar subject is required.");
  const start = new Date(input.startIso);
  const end = new Date(input.endIso);
  if (
    Number.isNaN(start.valueOf()) ||
    Number.isNaN(end.valueOf()) ||
    end <= start
  )
    throw new Error("A valid calendar start and end time are required.");
  const attendees = Array.from(
    new Set(
      input.attendees
        .map(value => value.trim().toLowerCase())
        .filter(value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    )
  );
  if (!attendees.length)
    throw new Error("At least one valid calendar attendee is required.");

  const mailbox = await getDelegatedMailboxAccess(input);
  const result = await delegatedMicrosoftGraphRequest<{
    id?: string;
    webLink?: string;
    iCalUId?: string;
  }>(mailbox.accessToken, "/me/events", {
    method: "POST",
    body: JSON.stringify({
      subject: input.subject.trim(),
      body: {
        contentType: "HTML",
        content: input.body.trim() || input.subject.trim(),
      },
      start: {
        dateTime: start.toISOString(),
        timeZone: input.timezone?.trim() || "UTC",
      },
      end: {
        dateTime: end.toISOString(),
        timeZone: input.timezone?.trim() || "UTC",
      },
      attendees: attendees.map(address => ({
        emailAddress: { address },
        type: "required",
      })),
      allowNewTimeProposals: true,
      transactionId: input.reviewReference.trim().slice(0, 255),
    }),
  });
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "delegated_calendar_event_created",
    entityType: "user_mailbox",
    entityId: String(input.userId),
    summary:
      "An approved calendar invitation was created from the salesperson's connected Microsoft account.",
    metadata: {
      provider: "microsoft",
      eventId: result.id,
      attendeeCount: attendees.length,
      reviewReference: input.reviewReference.trim().slice(0, 180),
    },
  });
  return {
    created: true as const,
    provider: "microsoft_delegated" as const,
    from: mailbox.email,
    eventId: result.id,
    webLink: result.webLink,
    iCalUId: result.iCalUId,
  };
}

type GraphInboxMessage = {
  id?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { content?: string };
  receivedDateTime?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
};

type GraphInboxPage = {
  value?: GraphInboxMessage[];
  "@odata.nextLink"?: string;
};

function plainMessageBody(message: GraphInboxMessage) {
  const value = message.body?.content || message.bodyPreview || "";
  return value
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

/**
 * Performs a bounded, user-owned inbox refresh and creates reviewable reply
 * proposals in the existing action queue. It never sends during synchronization.
 */
export async function syncDelegatedMailbox(input: {
  userId: number;
  organisationId: number;
}) {
  await requireOrganisationMembership(input.userId, input.organisationId);
  const syncStartedAt = new Date();
  const mailbox = await getDelegatedMailboxAccess(input);
  const db = await dbOrThrow();
  const connection = (
    await db
      .select({ lastSyncedAt: userMailboxConnections.lastSyncedAt })
      .from(userMailboxConnections)
      .where(eq(userMailboxConnections.id, mailbox.connectionId))
      .limit(1)
  )[0];
  const since =
    connection?.lastSyncedAt || new Date(Date.now() - 7 * 86_400_000);
  const query = new URLSearchParams({
    $top: "25",
    $orderby: "receivedDateTime asc",
    $select: "id,subject,bodyPreview,body,receivedDateTime,from",
    $filter: `receivedDateTime ge ${since.toISOString()}`,
  });

  let next: string | undefined =
    `/me/mailFolders/inbox/messages?${query.toString()}`;
  const inboxMessages: GraphInboxMessage[] = [];
  while (next && inboxMessages.length < MAX_INBOX_SYNC_MESSAGES) {
    const page: GraphInboxPage =
      await delegatedMicrosoftGraphRequest<GraphInboxPage>(
        mailbox.accessToken,
        next,
        { headers: { Prefer: 'outlook.body-content-type="text"' } }
      );
    inboxMessages.push(...(page.value || []));
    next = page["@odata.nextLink"];
  }

  const boundedMessages = inboxMessages.slice(0, MAX_INBOX_SYNC_MESSAGES);
  let received = 0;
  let draftsPrepared = 0;
  let newestProcessedAt: Date | undefined;
  for (const item of boundedMessages) {
    const sender = item.from?.emailAddress?.address?.trim().toLowerCase() || "";
    const body = plainMessageBody(item);
    const receivedAt = new Date(item.receivedDateTime || Date.now());
    if (!item.id || !sender || !body || Number.isNaN(receivedAt.valueOf()))
      continue;
    if (!newestProcessedAt || receivedAt > newestProcessedAt)
      newestProcessedAt = receivedAt;
    const ingested = await ingestInboundMessage({
      organisationId: input.organisationId,
      mailboxUserId: input.userId,
      envelope: {
        externalMessageId: item.id,
        channel: "email",
        senderReference: sender,
        subject: item.subject,
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
      `${item.subject || "customer email"} ${body}`
    );
    const response = await runGenxAgent({
      agentKey: "communications",
      messages: [
        {
          role: "user",
          content:
            "Draft only the natural reply body for the salesperson to review. Answer the customer's request using only the supplied evidence. Do not invent prices, guarantees, availability, commitments or customer facts. Keep the tone warm, clear and concise. Do not add a subject line or commentary about drafting.\n\n" +
            `From: ${item.from?.emailAddress?.name || sender} <${sender}>\n` +
            `Subject: ${item.subject || "Customer reply"}\n` +
            `Message: ${body.slice(0, 12_000)}`,
        },
      ],
      approvedKnowledge: knowledge
        .map(
          source =>
            `${source.title}\n${source.content || source.sourceUrl || ""}`
        )
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
    if (
      !draftBody ||
      /intelligence is not connected|cannot run safely/i.test(draftBody)
    )
      continue;
    await createWorkflowRun({
      userId: input.userId,
      organisationId: input.organisationId,
      workflowKey: "mailbox_inbound_reply",
      leadLabel: item.from?.emailAddress?.name?.trim() || sender,
      payload: { inboundMessageId: ingested.id, source: "personal_mailbox" },
      verificationSummary:
        "A customer email appears to need a reply. The draft was prepared from the inbound message and approved business knowledge, and still requires the salesperson's decision.",
      actions: [
        {
          actionType: "send_email_template",
          title: `Reply to ${item.from?.emailAddress?.name?.trim() || sender}`,
          targetLabel: item.from?.emailAddress?.name?.trim() || sender,
          idempotencyKey,
          payload: {
            reviewRequired: true,
            duplicateProtection:
              "Send this reviewed inbound reply only once from the connected personal mailbox.",
            crmRoute: {
              routable: true,
              provider: "personal_mailbox",
              mailboxProvider: "microsoft",
              displayName: "Your Microsoft mailbox",
              connectionMode: "delegated_oauth",
              requiredCapability: "Mail.Read + Mail.Send",
            },
            to: sender,
            subject: /^re:/i.test(item.subject || "")
              ? item.subject
              : `Re: ${item.subject || "Your message"}`,
            body: draftBody,
            why: ingested.classification.reasons.join("; "),
            inboundMessageId: ingested.id,
            contactExternalId: ingested.contactExternalId,
            customer: item.from?.emailAddress?.name?.trim() || sender,
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
    summary:
      "The salesperson's delegated inbox was checked for replies needing attention.",
    metadata: {
      received,
      draftsPrepared,
      messageLimit: MAX_INBOX_SYNC_MESSAGES,
      morePagesPending: Boolean(next),
      watermark: watermark.toISOString(),
    },
  });
  return { received, draftsPrepared, morePagesPending: Boolean(next) };
}

export async function disconnectDelegatedMailbox(input: {
  userId: number;
  organisationId: number;
}) {
  await requireOrganisationMembership(input.userId, input.organisationId);
  const db = await dbOrThrow();
  await db
    .delete(userMailboxConnections)
    .where(
      and(
        eq(userMailboxConnections.userId, input.userId),
        eq(userMailboxConnections.organisationId, input.organisationId)
      )
    );
  return { disconnected: true as const };
}
