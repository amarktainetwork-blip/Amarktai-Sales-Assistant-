import { genieConversationChannel } from "./genieMailboxRead";
import type { Page } from "playwright-core";
import type { NormalizedActivity } from "../crm/types";
/** Selected-contact history read. Notes and messages never mark conversations read. */
export async function readGenieContactHistory(input: {
  page: Page;
  ownerExternalId: string;
  contactExternalId: string;
  assertControl: () => void;
}) {
  const location = input.page.url().match(/\/v2\/location\/([^/]+)/)?.[1];
  if (!location || !input.ownerExternalId)
    throw Error("CRM_OWNER_SCOPE_REQUIRED");
  const token = await input.page.evaluate(async () =>
    String(await (window as any).getToken())
  );
  if (!token) throw Error("CRM_BROWSER_REAUTHENTICATION_REQUIRED");
  const get = async (path: string) => {
    input.assertControl();
    const r = await input.page
      .context()
      .request.get("https://services.leadconnectorhq.com" + path, {
        headers: {
          "token-id": token,
          version: "2021-07-28",
          channel: "APP",
          source: "WEB_USER",
        },
        timeout: 30000,
      });
    if (!r.ok()) throw Error(`GENIE_HISTORY_HTTP_${r.status()}`);
    return r.json();
  };
  const id = encodeURIComponent(input.contactExternalId);
  const contact = (await get("/contacts/" + id)).contact;
  if (
    contact?.id !== input.contactExternalId ||
    contact?.assignedTo !== input.ownerExternalId ||
    contact?.locationId !== location
  )
    throw Error("CRM_OWNER_SCOPE_VIOLATION");
  const activities: NormalizedActivity[] = [];
  const notes = await get("/contacts/" + id + "/notes");
  if (!Array.isArray(notes.notes)) throw Error("GENIE_NOTES_SCHEMA_REQUIRED");
  for (const n of notes.notes) {
    if (n.contactId !== input.contactExternalId)
      throw Error("CRM_CONTACT_SCOPE_VIOLATION");
    if (!n.id || !Number.isFinite(Date.parse(n.dateAdded)))
      throw Error("GENIE_NOTE_ID_AND_TIMESTAMP_REQUIRED");
    activities.push({
      externalId: "note:" + n.id,
      contactExternalId: input.contactExternalId,
      ownerExternalId: input.ownerExternalId,
      activityType: "note",
      occurredAt: new Date(n.dateAdded),
      body: typeof n.bodyText === "string" ? n.bodyText : n.body,
      raw: {
        sourceKind: "contact_note",
        authorExternalId: n.userId || null,
        ownerScope: "contact_assignee",
      },
    });
  }
  const threads = await get(
    `/conversations/search?locationId=${encodeURIComponent(location)}&contactId=${id}&limit=20`
  );
  if (!Array.isArray(threads.conversations))
    throw Error("GENIE_CONVERSATION_SCHEMA_REQUIRED");
  let truncated = Number(threads.total) > threads.conversations.length;
  for (const c of threads.conversations) {
    if (c.contactId !== input.contactExternalId || c.locationId !== location)
      throw Error("CRM_CONTACT_SCOPE_VIOLATION");
    if (c.assignedTo && c.assignedTo !== input.ownerExternalId) continue;
    const result = await get(
      "/conversations/" + encodeURIComponent(c.id) + "/messages?limit=100"
    );
    const messages = result.messages?.messages;
    if (!Array.isArray(messages)) throw Error("GENIE_MESSAGES_SCHEMA_REQUIRED");
    truncated ||= result.messages.nextPage === true;
    for (const m of messages) {
      if (m.contactId && m.contactId !== input.contactExternalId)
        throw Error("CRM_CONTACT_SCOPE_VIOLATION");
      if (m.deleted === true) continue;
      if (
        (m.locationId && m.locationId !== location) ||
        (m.conversationId && m.conversationId !== c.id)
      )
        throw Error("CRM_CONTACT_SCOPE_VIOLATION");
      if (!m.id || !Number.isFinite(Date.parse(m.dateAdded))) continue;
      let detail = m;
      if (![1, 2, 3].includes(Number(m.type))) {
        const rawDetail = await get(
          "/conversations/messages/" + encodeURIComponent(m.id)
        );
        detail = rawDetail?.message || rawDetail || m;
        if (
          (detail.contactId && detail.contactId !== input.contactExternalId) ||
          (detail.locationId && detail.locationId !== location) ||
          (detail.conversationId && detail.conversationId !== c.id)
        )
          throw Error("CRM_CONTACT_SCOPE_VIOLATION");
      }
      const messageType = String(
        detail.messageTypeString || detail.messageType || ""
      );
      activities.push({
        externalId: "message:" + m.id,
        contactExternalId: input.contactExternalId,
        ownerExternalId: input.ownerExternalId,
        activityType:
          genieConversationChannel(detail) === "chat"
            ? "whatsapp"
            : Number(detail.type ?? m.type) === 3
              ? "email"
              : Number(detail.type ?? m.type) === 2
                ? "sms"
                : Number(detail.type ?? m.type) === 1
                  ? "call"
                  : "communication",
        occurredAt: new Date(detail.dateAdded || m.dateAdded),
        body:
          typeof detail.body === "string"
            ? detail.body
            : typeof m.body === "string"
              ? m.body
              : undefined,
        raw: {
          sourceKind: "conversation_message",
          conversationExternalId: c.id,
          direction: detail.direction || m.direction || null,
          sourceType: Number(detail.type ?? m.type),
          messageTypeString: messageType || null,
          senderReference: detail.from || detail.meta?.from || null,
          recipientReference: detail.to || detail.meta?.to || null,
          ownerScope: "contact_assignee",
        },
      });
    }
  }
  return {
    activities,
    coverage: {
      notes: "complete" as const,
      communications: truncated
        ? ("recent_page" as const)
        : ("complete" as const),
      refreshedAt: new Date().toISOString(),
    },
  };
}
