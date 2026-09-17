type Activity = {
  id: number;
  externalId: string;
  activityType: string;
  occurredAt: Date | string;
  body?: string | null;
  raw?: unknown;
};
type Message = {
  id: number;
  externalMessageId: string;
  channel: string;
  receivedAt: Date | string;
  body: string;
  subject?: string | null;
  needsAction: boolean;
  classification?: unknown;
};
export type CustomerHistoryItem = {
  id: string;
  channel: string;
  direction: string;
  occurredAt: Date | string;
  body: string;
  subject?: string | null;
  needsAction: boolean;
};
function metadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
/** A presentation of the existing CRM activity and inbound sources, never a new store. */
export function customerHistory(
  activities: Activity[],
  messages: Message[]
): CustomerHistoryItem[] {
  const records = new Map<string, CustomerHistoryItem>();
  for (const activity of activities) {
    const raw = metadata(activity.raw);
    records.set(activity.externalId, {
      id: `activity:${activity.id}`,
      channel:
        (
          {
            email: "Email",
            sms: "SMS",
            whatsapp: "WhatsApp",
            call: "Call",
            note: "Note",
          } as Record<string, string>
        )[activity.activityType] || "Communication",
      direction:
        raw.direction === "inbound"
          ? "Received"
          : raw.direction === "outbound"
            ? "Sent"
            : activity.activityType === "note"
              ? "Note"
              : "Direction not recorded",
      occurredAt: activity.occurredAt,
      body: activity.body || "",
      needsAction: false,
    });
  }
  for (const message of messages) {
    const key = `message:${message.externalMessageId}`;
    const existing = records.get(key);
    records.set(key, {
      id: existing?.id || `inbound:${message.id}`,
      channel:
        message.channel === "chat"
          ? metadata(message.classification).sourceChannel === "whatsapp"
            ? "WhatsApp"
            : "Chat"
          : message.channel === "sms"
            ? "SMS"
            : message.channel === "email"
              ? "Email"
              : "Message",
      direction: "Received",
      occurredAt: message.receivedAt,
      body: message.body,
      subject: message.subject,
      needsAction: message.needsAction,
    });
  }
  return Array.from(records.values()).sort(
    (a, b) =>
      new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  );
}
