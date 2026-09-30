import type { Page } from "playwright-core";
const ROOT = "https://services.leadconnectorhq.com";
const BOOTSTRAP =
  "https://backend.leadsconnectorhq.com/conversations/inbox-bootstrap";
const CONVERSATION_SEARCH_PAGE_SIZE = 20;
const MAX_LIVE_CONVERSATIONS_PER_CYCLE = 10;
const MAX_LIVE_MESSAGE_PAGES_PER_CYCLE = 6;
const MAX_LEGACY_BACKFILL_PAGES_PER_CYCLE = 3;
const id = (value: unknown) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,180}$/.test(value)
    ? value
    : null;

const MAX_SOURCE_FUTURE_SKEW_MS = 5 * 60_000;

export function normalizeGenieMessageTime(
  value: unknown,
  observedAtMs = Date.now()
) {
  const date = new Date(String(value ?? ""));
  if (!Number.isFinite(date.getTime())) return null;
  if (date.getTime() > observedAtMs + MAX_SOURCE_FUTURE_SKEW_MS)
    return new Date(observedAtMs);
  return date;
}
export function mailboxAddress(value: unknown) {
  if (typeof value !== "string") return "";
  const match = value
    .trim()
    .match(/^(?:[^<>]*<)?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>?$/i);
  return match?.[1]?.toLowerCase() || "";
}
export function parsePersonalGenieEmail(
  value: any,
  input: {
    emailId: string;
    mailboxEmail: string;
    locationId: string;
    conversationId: string;
    since: number;
    contactExternalId?: string;
  }
) {
  const email = value?.emailMessage || value;
  if (!email || email.deleted === true || email.direction !== "inbound")
    return { kind: "excluded" as const };
  if (
    email.id !== input.emailId ||
    email.locationId !== input.locationId ||
    email.conversationId !== input.conversationId ||
    (input.contactExternalId &&
      email.contactId &&
      email.contactId !== input.contactExternalId)
  )
    throw Error("GENIE_MAILBOX_SCOPE_MISMATCH");
  const receivedAt = normalizeGenieMessageTime(email.dateAdded);
  if (!receivedAt || receivedAt.getTime() < input.since)
    return { kind: "excluded" as const };
  const rawRecipients = Array.isArray(email.to)
    ? email.to
    : typeof email.to === "string"
      ? [email.to]
      : [];
  const recipients = rawRecipients.map(mailboxAddress).filter(Boolean);
  if (!recipients.length) return { kind: "excluded" as const };
  const mailboxEmail = input.mailboxEmail.toLowerCase();
  if (!recipients.includes(mailboxEmail))
    return { kind: "foreign_recipient" as const };
  const sender = mailboxAddress(email.from);
  if (
    !sender ||
    sender === mailboxEmail ||
    typeof email.body !== "string" ||
    !email.body.trim()
  )
    return { kind: "excluded" as const };
  return {
    kind: "personal" as const,
    message: {
      emailId: email.id as string,
      sender,
      recipient: mailboxEmail,
      body: email.body,
      subject: typeof email.subject === "string" ? email.subject : undefined,
      receivedAt,
      contactExternalId: id(email.contactId) || undefined,
    },
  };
}

export type GenieLiveMailboxProgress = {
  sourceSince: string;
  searchCursor?: string;
  conversations?: Array<{
    id: string;
    contactId: string;
    locationId: string;
    assignedTo?: string;
    lastMessageDate?: string;
  }>;
  nextSearchCursor?: string;
  conversationIndex?: number;
  lastMessageId?: string;
};

export type PersonalGenieMailboxRecord = {
  externalMessageId: string;
  channel: "email" | "sms" | "chat";
  sender: string;
  recipient?: string;
  body: string;
  subject?: string;
  receivedAt: Date;
  contactExternalId?: string;
  conversationExternalId: string;
};

export type PersonalGenieOutboundEvidence = {
  externalMessageId: string;
  channel: "email" | "sms" | "chat";
  contactExternalId: string;
  conversationExternalId: string;
  sentAt: Date;
  inboundExternalMessageId?: string;
  verifiedAfterInboundByThreadOrder?: boolean;
};


export type LegacyGenieBackfillProgress = {
  conversationExternalId: string;
  lastMessageId: string;
  candidateOutboundEvidence?: PersonalGenieOutboundEvidence;
};

export type LegacyGenieInboundReference = {
  externalMessageId: string;
  channel: "email" | "sms" | "chat";
  contactExternalId: string;
  receivedAt: Date;
  backfillProgress?: LegacyGenieBackfillProgress;
};

export type LegacyGenieConversationLink = {
  inboundExternalMessageId: string;
  contactExternalId: string;
  conversationExternalId: string;
};

export function legacyGenieOutboundEvidence(
  thread: any,
  input: {
    channel: "email" | "sms" | "chat";
    locationId: string;
    conversationId: string;
    contactExternalId: string;
    receivedAt: Date;
    sourceReceivedAtRawMs?: number;
    inboundExternalMessageId?: string;
    verifiedAfterInboundByThreadOrder?: boolean;
  }
): PersonalGenieOutboundEvidence | undefined {
  if (!thread || thread.deleted === true || thread.direction !== "outbound")
    return undefined;
  if (
    thread.locationId !== input.locationId ||
    thread.conversationId !== input.conversationId ||
    (thread.contactId && thread.contactId !== input.contactExternalId)
  )
    throw Error("GENIE_MAILBOX_SCOPE_MISMATCH");
  const rawSentAtMs = Date.parse(String(thread.dateAdded || ""));
  const sentAt = normalizeGenieMessageTime(thread.dateAdded);
  const followsInbound = Number.isFinite(input.sourceReceivedAtRawMs)
    ? Number.isFinite(rawSentAtMs) && rawSentAtMs > input.sourceReceivedAtRawMs!
    : input.verifiedAfterInboundByThreadOrder === true ||
      Boolean(sentAt && sentAt.getTime() > input.receivedAt.getTime());
  if (!sentAt || !followsInbound) return undefined;
  const channel =
    Number(thread.type) === 3 ? ("email" as const) : genieConversationChannel(thread);
  if (!channel || channel !== input.channel) return undefined;
  const externalMessageId =
    id(thread.id) ||
    (Array.isArray(thread.meta?.email?.messageIds)
      ? id(thread.meta.email.messageIds[0])
      : null);
  if (!externalMessageId) return undefined;
  return {
    externalMessageId,
    channel,
    contactExternalId: input.contactExternalId,
    conversationExternalId: input.conversationId,
    sentAt,
    ...(input.inboundExternalMessageId
      ? { inboundExternalMessageId: input.inboundExternalMessageId }
      : {}),
    ...(input.verifiedAfterInboundByThreadOrder
      ? { verifiedAfterInboundByThreadOrder: true }
      : {}),
  };
}

export function parsePersonalGenieOutboundEmail(
  value: any,
  input: {
    emailId: string;
    locationId: string;
    conversationId: string;
    contactExternalId: string;
    since: number;
  }
) {
  const email = value?.emailMessage || value;
  if (!email || email.deleted === true || email.direction !== "outbound")
    return { kind: "excluded" as const };
  if (
    email.id !== input.emailId ||
    email.locationId !== input.locationId ||
    email.conversationId !== input.conversationId ||
    email.contactId !== input.contactExternalId
  )
    throw Error("GENIE_MAILBOX_SCOPE_MISMATCH");
  const sentAt = normalizeGenieMessageTime(email.dateAdded);
  if (!sentAt || sentAt.getTime() < input.since)
    return { kind: "excluded" as const };
  return {
    kind: "outbound" as const,
    evidence: {
      externalMessageId: email.id as string,
      channel: "email" as const,
      contactExternalId: input.contactExternalId,
      conversationExternalId: input.conversationId,
      sentAt,
    },
  };
}

export function genieConversationChannel(value: any) {
  const messageType = String(
    value?.messageTypeString || value?.messageType || ""
  ).toUpperCase();
  if (messageType.includes("WHATSAPP")) return "chat" as const;
  if (messageType.includes("SMS")) return "sms" as const;
  // HighLevel's current conversation message contract uses numeric type 1 for
  // calls and type 2 for SMS. Email (type 3) is handled by the dedicated email
  // detail endpoint because it has stricter recipient-isolation requirements.
  if (Number(value?.type) === 2) return "sms" as const;
  return null;
}

function phoneReference(value: unknown) {
  if (typeof value !== "string") return "";
  const normalized = value
    .trim()
    .replace(/^(?:whatsapp|sms|tel):/i, "")
    .trim();
  return /^[+0-9][0-9+ ()-]{5,40}$/.test(normalized) ? normalized : "";
}

export function parsePersonalGenieConversationMessage(
  value: any,
  input: {
    messageId: string;
    locationId: string;
    conversationId: string;
    contactExternalId: string;
    since: number;
  }
) {
  const message = value?.message || value;
  if (!message || message.deleted === true || message.direction !== "inbound")
    return { kind: "excluded" as const };
  if (
    message.id !== input.messageId ||
    message.locationId !== input.locationId ||
    message.conversationId !== input.conversationId ||
    message.contactId !== input.contactExternalId
  )
    throw Error("GENIE_MAILBOX_SCOPE_MISMATCH");
  const receivedAt = normalizeGenieMessageTime(message.dateAdded);
  if (!receivedAt || receivedAt.getTime() < input.since)
    return { kind: "excluded" as const };
  const channel = genieConversationChannel(message);
  if (!channel) return { kind: "excluded" as const };
  const body = typeof message.body === "string" ? message.body.trim() : "";
  if (!body) return { kind: "excluded" as const };
  const sender =
    phoneReference(message.from) ||
    phoneReference(message.meta?.from) ||
    phoneReference(message.sender);
  if (!sender) return { kind: "excluded" as const };
  const recipient =
    phoneReference(message.to) || phoneReference(message.meta?.to) || undefined;
  return {
    kind: "personal" as const,
    message: {
      externalMessageId: message.id as string,
      channel,
      sender,
      recipient,
      body,
      subject: channel === "chat" ? "WhatsApp message" : "SMS message",
      receivedAt,
      contactExternalId: input.contactExternalId,
      conversationExternalId: input.conversationId,
    },
  };
}

export async function readPersonalGenieMailbox(input: {
  page: Page;
  ownerExternalId: string;
  mailboxEmail: string;
  since: Date;
  liveProgress?: GenieLiveMailboxProgress;
  unresolved?: LegacyGenieInboundReference[];
}) {
  const locationId = input.page
    .url()
    .match(/\/v2\/location\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1];
  if (
    !locationId ||
    !id(input.ownerExternalId) ||
    !mailboxAddress(input.mailboxEmail)
  )
    throw Error("GENIE_MAILBOX_IDENTITY_REQUIRED");
  const getToken = () =>
    input.page.evaluate(async () => {
      const f = (window as Window & { getToken?: () => unknown }).getToken;
      return typeof f === "function" ? String(await f()) : "";
    });
  let token = await getToken();
  let refreshed = false;
  const read = async (
    path: string,
    bootstrap = false,
    params?: Record<string, string | number>
  ) => {
    const call = () => {
      if (!token) throw Error("CRM_BROWSER_REAUTHENTICATION_REQUIRED");
      const options = {
        headers: {
          "content-type": "application/json",
          channel: "APP",
          source: "WEB_USER",
          version: "2021-07-28",
          "token-id": token,
        },
        timeout: 30000,
      };
      return bootstrap
        ? input.page.context().request.post(BOOTSTRAP, {
            ...options,
            data: {
              locationId,
              userId: input.ownerExternalId,
              category: "teamInbox",
              status: "unread",
              saveFilters: false,
              messages: { limit: 20 },
            },
          })
        : input.page.context().request.get(ROOT + path, { ...options, params });
    };
    let response = await call();
    if (response.status() === 401 && !refreshed) {
      refreshed = true;
      token = await getToken();
      response = await call();
    }
    if (!response.ok())
      throw Error(`GENIE_MAILBOX_READ_HTTP_${response.status()}`);
    return response.json();
  };
  const requestedSince = input.since.getTime();
  const progressSince = Date.parse(String(input.liveProgress?.sourceSince || ""));
  const since =
    Number.isFinite(progressSince) && progressSince > 0
      ? progressSince
      : requestedSince;
  if (!Number.isFinite(since) || since <= 0)
    throw Error("GENIE_MAILBOX_CURSOR_REQUIRED");

  // Preserve a before/after unread snapshot as a read-only safety proof, but do
  // not use unread state as the ingestion cursor. A salesperson may read a
  // message in Genie before our worker sees it; source truth must still ingest it.
  const before = await read("", true);
  const beforeUnread = before.search?.conversations;
  if (!Array.isArray(beforeUnread)) throw Error("GENIE_MAILBOX_SEARCH_INVALID");

  const snapshotConversation = (conversation: any) => ({
    id: String(conversation.id || ""),
    contactId: String(conversation.contactId || ""),
    locationId: String(conversation.locationId || ""),
    ...(typeof conversation.assignedTo === "string"
      ? { assignedTo: conversation.assignedTo }
      : {}),
    ...(conversation.lastMessageDate !== undefined &&
    conversation.lastMessageDate !== null
      ? { lastMessageDate: String(conversation.lastMessageDate) }
      : {}),
  });

  let conversations: any[] = [];
  let nextSearchCursor: string | undefined;
  let conversationIndex = Math.max(
    0,
    Number(input.liveProgress?.conversationIndex || 0) || 0
  );
  let resumedLastMessageId = id(input.liveProgress?.lastMessageId) || undefined;

  if (input.liveProgress?.conversations?.length) {
    conversations = input.liveProgress.conversations.map(snapshotConversation);
    nextSearchCursor = input.liveProgress.nextSearchCursor;
    if (conversationIndex >= conversations.length) {
      conversations = [];
      conversationIndex = 0;
      resumedLastMessageId = undefined;
    }
  }

  if (!conversations.length) {
    const searchCursor =
      typeof input.liveProgress?.searchCursor === "string" &&
      input.liveProgress.searchCursor.trim()
        ? input.liveProgress.searchCursor.trim()
        : undefined;
    const search = await read("/conversations/search", false, {
      locationId,
      assignedTo: input.ownerExternalId,
      sort: "desc",
      sortBy: "last_message_date",
      status: "all",
      limit: CONVERSATION_SEARCH_PAGE_SIZE,
      ...(searchCursor ? { startAfterDate: searchCursor } : {}),
    });
    const pageConversations = search.conversations;
    if (!Array.isArray(pageConversations))
      throw Error("GENIE_MAILBOX_SEARCH_INVALID");
    conversations = pageConversations.map(snapshotConversation);
    conversationIndex = 0;
    resumedLastMessageId = undefined;

    const oldestPageTime = pageConversations.reduce(
      (oldest: number, conversation: any) => {
        const parsed = Date.parse(String(conversation?.lastMessageDate || ""));
        return Number.isFinite(parsed) ? Math.min(oldest, parsed) : oldest;
      },
      Number.POSITIVE_INFINITY
    );
    if (
      pageConversations.length === CONVERSATION_SEARCH_PAGE_SIZE &&
      oldestPageTime >= since
    ) {
      const meta =
        search.meta &&
        typeof search.meta === "object" &&
        !Array.isArray(search.meta)
          ? search.meta
          : {};
      const rawNext = [
        search.nextPage,
        search.nextCursor,
        (meta as Record<string, unknown>).nextCursor,
      ].find(
        value =>
          (typeof value === "string" || typeof value === "number") &&
          String(value).trim()
      );
      nextSearchCursor =
        rawNext === undefined ? undefined : String(rawNext).trim() || undefined;
      if (!nextSearchCursor && Number(search.total || 0) > pageConversations.length)
        throw Error("GENIE_MAILBOX_CONTINUATION_REQUIRED");
      if (nextSearchCursor && nextSearchCursor === searchCursor)
        throw Error("GENIE_MAILBOX_SEARCH_CURSOR_STALLED");
    }
  }

  const records = new Map<string, PersonalGenieMailboxRecord>();
  const outboundEvidence = new Map<string, PersonalGenieOutboundEvidence>();
  const legacyConversationLinks = new Map<string, LegacyGenieConversationLink>();
  const legacyBackfillProgress = new Map<string, LegacyGenieBackfillProgress>();
  const visited = new Set<string>();
  let rejectedForeignRecipientCount = 0;
  let rejectedForeignOwnerCount = 0;
  let examined = 0;
  let checked = 0;
  let liveMessagePagesRead = 0;
  let liveConversationsProcessed = 0;
  let liveProgress: GenieLiveMailboxProgress | undefined;

  liveTraversal: for (
    let index = conversationIndex;
    index < conversations.length;
    index++
  ) {
    if (liveConversationsProcessed >= MAX_LIVE_CONVERSATIONS_PER_CYCLE) {
      liveProgress = {
        sourceSince: new Date(since).toISOString(),
        conversations: conversations.map(snapshotConversation),
        nextSearchCursor,
        conversationIndex: index,
      };
      break;
    }

    const conversation = conversations[index];
    checked += 1;
    const conversationLastMessageAt = Date.parse(
      String(conversation.lastMessageDate || "")
    );
    if (
      Number.isFinite(conversationLastMessageAt) &&
      conversationLastMessageAt < since
    ) {
      nextSearchCursor = undefined;
      break;
    }
    const conversationId = id(conversation.id);
    const contactExternalId = id(conversation.contactId);
    if (
      !conversationId ||
      !contactExternalId ||
      conversation.locationId !== locationId
    )
      throw Error("GENIE_MAILBOX_CONVERSATION_SCOPE_REQUIRED");

    if (
      conversation.assignedTo &&
      conversation.assignedTo !== input.ownerExternalId
    ) {
      rejectedForeignOwnerCount++;
      liveConversationsProcessed += 1;
      resumedLastMessageId = undefined;
      continue;
    }
    const contact = (await read(`/contacts/${contactExternalId}`)).contact;
    const exactOwner = Boolean(
      contact?.id === contactExternalId &&
        contact?.locationId === locationId &&
        contact?.assignedTo === input.ownerExternalId
    );
    if (!exactOwner) {
      rejectedForeignOwnerCount++;
      liveConversationsProcessed += 1;
      resumedLastMessageId = undefined;
      continue;
    }

    let lastMessageId =
      index === conversationIndex ? resumedLastMessageId : undefined;
    for (;;) {
      if (liveMessagePagesRead >= MAX_LIVE_MESSAGE_PAGES_PER_CYCLE) {
        liveProgress = {
          sourceSince: new Date(since).toISOString(),
          conversations: conversations.map(snapshotConversation),
          nextSearchCursor,
          conversationIndex: index,
          ...(lastMessageId ? { lastMessageId } : {}),
        };
        break liveTraversal;
      }
      const result = await read(
        `/conversations/${conversationId}/messages`,
        false,
        { limit: 100, ...(lastMessageId ? { lastMessageId } : {}) }
      );
      liveMessagePagesRead += 1;
      const messages = result.messages?.messages;
      if (!Array.isArray(messages))
        throw Error("GENIE_MAILBOX_MESSAGES_INVALID");
      let reachedBeforeSince = false;
      for (const thread of messages) {
        if (thread.deleted === true) continue;
        if (
          thread.locationId !== locationId ||
          thread.conversationId !== conversationId
        )
          throw Error("GENIE_MAILBOX_SCOPE_MISMATCH");
        const threadAt = Date.parse(String(thread.dateAdded || ""));
        if (Number.isFinite(threadAt) && threadAt < since) {
          reachedBeforeSince = true;
          continue;
        }

        if (Number(thread.type) === 3) {
          for (const emailId of thread.meta?.email?.messageIds || []) {
            if (!id(emailId) || visited.has(emailId)) continue;
            visited.add(emailId);
            examined++;
            const raw = await read(`/conversations/messages/email/${emailId}`);
            const outbound = parsePersonalGenieOutboundEmail(raw, {
              emailId,
              locationId,
              conversationId,
              contactExternalId,
              since,
            });
            if (outbound.kind === "outbound") {
              outboundEvidence.set(emailId, outbound.evidence);
              continue;
            }
            const parsed = parsePersonalGenieEmail(raw, {
              emailId,
              mailboxEmail: input.mailboxEmail,
              locationId,
              conversationId,
              contactExternalId,
              since,
            });
            if (parsed.kind === "foreign_recipient") {
              rejectedForeignRecipientCount++;
              continue;
            }
            if (parsed.kind === "personal")
              records.set(emailId, {
                externalMessageId: parsed.message.emailId,
                channel: "email",
                sender: parsed.message.sender,
                recipient: parsed.message.recipient,
                body: parsed.message.body,
                subject: parsed.message.subject,
                receivedAt: parsed.message.receivedAt,
                contactExternalId:
                  parsed.message.contactExternalId || contactExternalId,
                conversationExternalId: conversationId,
              });
          }
          continue;
        }

        if (thread.direction === "outbound") {
          const messageId = id(thread.id);
          const channel = genieConversationChannel(thread);
          const sentAt = normalizeGenieMessageTime(thread.dateAdded);
          if (
            messageId &&
            channel &&
            sentAt &&
            sentAt.getTime() >= since
          )
            outboundEvidence.set(messageId, {
              externalMessageId: messageId,
              channel,
              contactExternalId,
              conversationExternalId: conversationId,
              sentAt,
            });
          continue;
        }
        if (thread.direction !== "inbound") continue;
        const messageId = id(thread.id);
        if (!messageId || visited.has(messageId)) continue;
        visited.add(messageId);
        examined++;
        const raw = await read(`/conversations/messages/${messageId}`);
        const parsed = parsePersonalGenieConversationMessage(raw, {
          messageId,
          locationId,
          conversationId,
          contactExternalId,
          since,
        });
        if (parsed.kind === "personal") records.set(messageId, parsed.message);
      }
      if (reachedBeforeSince || !result.messages.nextPage) {
        liveConversationsProcessed += 1;
        resumedLastMessageId = undefined;
        break;
      }
      const next = id(result.messages.lastMessageId);
      if (!next || next === lastMessageId)
        throw Error("GENIE_MAILBOX_CURSOR_STALLED");
      if (liveMessagePagesRead >= MAX_LIVE_MESSAGE_PAGES_PER_CYCLE) {
        liveProgress = {
          sourceSince: new Date(since).toISOString(),
          conversations: conversations.map(snapshotConversation),
          nextSearchCursor,
          conversationIndex: index,
          lastMessageId: next,
        };
        break liveTraversal;
      }
      lastMessageId = next;
    }
  }

  if (!liveProgress) {
    const nextIndex = conversationIndex + liveConversationsProcessed;
    if (nextIndex < conversations.length) {
      liveProgress = {
        sourceSince: new Date(since).toISOString(),
        conversations: conversations.map(snapshotConversation),
        nextSearchCursor,
        conversationIndex: nextIndex,
      };
    } else if (nextSearchCursor) {
      liveProgress = {
        sourceSince: new Date(since).toISOString(),
        searchCursor: nextSearchCursor,
      };
    }
  }
  for (const unresolved of input.unresolved || []) {
    const externalMessageId = id(unresolved.externalMessageId);
    const contactExternalId = id(unresolved.contactExternalId);
    if (
      !externalMessageId ||
      !contactExternalId ||
      !["email", "sms", "chat"].includes(unresolved.channel) ||
      !Number.isFinite(unresolved.receivedAt.getTime())
    )
      continue;

    const contact = (await read(`/contacts/${contactExternalId}`)).contact;
    if (
      contact?.id !== contactExternalId ||
      contact?.locationId !== locationId ||
      contact?.assignedTo !== input.ownerExternalId
    ) {
      rejectedForeignOwnerCount++;
      continue;
    }

    const raw =
      unresolved.channel === "email"
        ? await read(`/conversations/messages/email/${externalMessageId}`)
        : await read(`/conversations/messages/${externalMessageId}`);
    const source =
      unresolved.channel === "email"
        ? raw?.emailMessage || raw
        : raw?.message || raw;
    if (
      !source ||
      source.deleted === true ||
      source.direction !== "inbound" ||
      source.id !== externalMessageId ||
      source.locationId !== locationId ||
      source.contactId !== contactExternalId
    )
      continue;
    const conversationId = id(source.conversationId);
    if (!conversationId) continue;
    if (
      unresolved.channel !== "email" &&
      genieConversationChannel(source) !== unresolved.channel
    )
      continue;

    legacyConversationLinks.set(externalMessageId, {
      inboundExternalMessageId: externalMessageId,
      contactExternalId,
      conversationExternalId: conversationId,
    });

    const savedProgress =
      unresolved.backfillProgress?.conversationExternalId === conversationId
        ? unresolved.backfillProgress
        : undefined;
    let lastMessageId = id(savedProgress?.lastMessageId) || undefined;
    let candidateOutboundEvidence = savedProgress?.candidateOutboundEvidence;
    let foundReply = false;
    let reachedExactInbound = false;
    let pagesRead = 0;
    while (!foundReply) {
      pagesRead += 1;
      const result = await read(
        `/conversations/${conversationId}/messages`,
        false,
        { limit: 100, ...(lastMessageId ? { lastMessageId } : {}) }
      );
      const messages = result.messages?.messages;
      if (!Array.isArray(messages))
        throw Error("GENIE_MAILBOX_MESSAGES_INVALID");
      for (const thread of messages) {
        if (thread.deleted === true) continue;
        if (
          thread.locationId !== locationId ||
          thread.conversationId !== conversationId
        )
          throw Error("GENIE_MAILBOX_SCOPE_MISMATCH");

        const threadMessageIds = [
          id(thread.id),
          ...(Array.isArray(thread.meta?.email?.messageIds)
            ? thread.meta.email.messageIds.map((value: unknown) => id(value))
            : []),
        ].filter(Boolean);
        if (!threadMessageIds.includes(externalMessageId)) {
          if (!candidateOutboundEvidence) {
            const evidence = legacyGenieOutboundEvidence(thread, {
              channel: unresolved.channel,
              locationId,
              conversationId,
              contactExternalId,
              receivedAt: unresolved.receivedAt,
              inboundExternalMessageId: externalMessageId,
              verifiedAfterInboundByThreadOrder: true,
            });
            if (evidence) candidateOutboundEvidence = evidence;
          }
          continue;
        }

        reachedExactInbound = true;
        // The message list is newest-first. A persisted or same-cycle outbound
        // candidate was observed before this exact inbound message, so thread
        // order proves the reply happened after this inbound even if clocks skew.
        if (candidateOutboundEvidence) {
          outboundEvidence.set(
            candidateOutboundEvidence.externalMessageId,
            candidateOutboundEvidence
          );
          foundReply = true;
        }
        break;
      }
      if (foundReply || reachedExactInbound || !result.messages.nextPage) break;
      const next = id(result.messages.lastMessageId);
      if (!next || next === lastMessageId)
        throw Error("GENIE_MAILBOX_CURSOR_STALLED");
      if (pagesRead >= MAX_LEGACY_BACKFILL_PAGES_PER_CYCLE) {
        legacyBackfillProgress.set(externalMessageId, {
          conversationExternalId: conversationId,
          lastMessageId: next,
          ...(candidateOutboundEvidence ? { candidateOutboundEvidence } : {}),
        });
        break;
      }
      lastMessageId = next;
    }
  }

  const after = await read("", true);
  const unreadPreserved = beforeUnread.every((previous: any) =>
    after.search?.conversations?.some(
      (current: any) =>
        current.id === previous.id &&
        current.unreadCount >= previous.unreadCount
    )
  );
  if (!unreadPreserved) throw Error("GENIE_MAILBOX_UNREAD_STATE_CHANGED");
  return {
    records: Array.from(records.values()),
    outboundEvidence: Array.from(outboundEvidence.values()),
    legacyConversationLinks: Array.from(legacyConversationLinks.values()),
    legacyBackfillProgress: Array.from(legacyBackfillProgress.entries()).map(
      ([inboundExternalMessageId, progress]) => ({
        inboundExternalMessageId,
        ...progress,
      })
    ),
    liveProgress,
    checked,
    examined,
    rejectedForeignRecipientCount,
    rejectedForeignOwnerCount,
    unreadPreserved,
    readOnlySource: true,
    bounded: Boolean(liveProgress || legacyBackfillProgress.size),
  };
}
