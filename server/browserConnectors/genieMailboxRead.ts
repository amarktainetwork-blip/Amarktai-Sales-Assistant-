import type { Page } from "playwright-core";
const ROOT = "https://services.leadconnectorhq.com";
const BOOTSTRAP =
  "https://backend.leadsconnectorhq.com/conversations/inbox-bootstrap";
const id = (value: unknown) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,180}$/.test(value)
    ? value
    : null;
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
    unreadSince: number;
  }
) {
  const email = value?.emailMessage || value;
  if (!email || email.deleted === true || email.direction !== "inbound")
    return { kind: "excluded" as const };
  if (
    email.id !== input.emailId ||
    email.locationId !== input.locationId ||
    email.conversationId !== input.conversationId
  )
    throw Error("GENIE_MAILBOX_SCOPE_MISMATCH");
  const receivedAt = new Date(email.dateAdded);
  if (
    !Number.isFinite(receivedAt.getTime()) ||
    receivedAt.getTime() < input.unreadSince
  )
    return { kind: "excluded" as const };
  const recipients = Array.isArray(email.to)
    ? email.to.map(mailboxAddress)
    : [];
  // Multi-recipient/team messages fail closed as well as another mailbox's mail.
  if (
    recipients.length !== 1 ||
    recipients[0] !== input.mailboxEmail.toLowerCase()
  )
    return { kind: "foreign" as const };
  const sender = mailboxAddress(email.from);
  if (
    !sender ||
    sender === input.mailboxEmail.toLowerCase() ||
    typeof email.body !== "string" ||
    !email.body.trim()
  )
    return { kind: "excluded" as const };
  return {
    kind: "personal" as const,
    message: {
      emailId: email.id as string,
      sender,
      recipient: recipients[0],
      body: email.body,
      subject: typeof email.subject === "string" ? email.subject : undefined,
      receivedAt,
      contactExternalId: id(email.contactId) || undefined,
    },
  };
}
export async function readPersonalGenieMailbox(input: {
  page: Page;
  ownerExternalId: string;
  mailboxEmail: string;
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
        ? input.page
            .context()
            .request.post(BOOTSTRAP, {
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
  const before = await read("", true);
  const conversations = before.search?.conversations;
  if (!Array.isArray(conversations))
    throw Error("GENIE_MAILBOX_SEARCH_INVALID");
  const records = new Map<
    string,
    Extract<
      ReturnType<typeof parsePersonalGenieEmail>,
      { kind: "personal" }
    >["message"]
  >();
  const visited = new Set<string>();
  let rejectedForeignRecipientCount = 0;
  let examined = 0;
  let bounded = false;
  for (const conversation of conversations.slice(0, 20)) {
    if (
      !id(conversation.id) ||
      conversation.locationId !== locationId ||
      !(conversation.unreadCount > 0)
    )
      throw Error("GENIE_MAILBOX_CONVERSATION_SCOPE_REQUIRED");
    const unreadSince = Number(conversation.firstUnreadInboundTimestamp);
    if (!Number.isFinite(unreadSince) || unreadSince <= 0) continue;
    let lastMessageId: string | undefined;
    for (let pageNumber = 0; pageNumber < 5; pageNumber++) {
      const result = await read(
        `/conversations/${conversation.id}/messages`,
        false,
        { limit: 100, ...(lastMessageId ? { lastMessageId } : {}) }
      );
      const messages = result.messages?.messages;
      if (!Array.isArray(messages))
        throw Error("GENIE_MAILBOX_MESSAGES_INVALID");
      for (const thread of messages) {
        if (thread.type !== 3 || thread.deleted === true) continue;
        if (
          thread.locationId !== locationId ||
          thread.conversationId !== conversation.id
        )
          throw Error("GENIE_MAILBOX_SCOPE_MISMATCH");
        for (const emailId of thread.meta?.email?.messageIds || []) {
          if (!id(emailId) || visited.has(emailId)) continue;
          if (examined >= 200) {
            bounded = true;
            break;
          }
          visited.add(emailId);
          examined++;
          const raw = await read(`/conversations/messages/email/${emailId}`);
          const parsed = parsePersonalGenieEmail(raw, {
            emailId,
            mailboxEmail: input.mailboxEmail,
            locationId,
            conversationId: conversation.id,
            unreadSince,
          });
          if (parsed.kind === "foreign") rejectedForeignRecipientCount++;
          if (parsed.kind === "personal") records.set(emailId, parsed.message);
        }
        if (bounded) break;
      }
      if (bounded || !result.messages.nextPage) break;
      const next = id(result.messages.lastMessageId);
      if (!next || next === lastMessageId)
        throw Error("GENIE_MAILBOX_CURSOR_STALLED");
      lastMessageId = next;
      if (pageNumber === 4) bounded = true;
    }
    if (bounded) break;
  }
  const after = await read("", true);
  const unreadPreserved = conversations.every((previous: any) =>
    after.search?.conversations?.some(
      (current: any) =>
        current.id === previous.id &&
        current.unreadCount >= previous.unreadCount
    )
  );
  if (!unreadPreserved) throw Error("GENIE_MAILBOX_UNREAD_STATE_CHANGED");
  return {
    records: Array.from(records.values()),
    checked: Math.min(conversations.length, 20),
    examined,
    rejectedForeignRecipientCount,
    unreadPreserved,
    readOnlySource: true,
    bounded: bounded || conversations.length > 20,
  };
}
