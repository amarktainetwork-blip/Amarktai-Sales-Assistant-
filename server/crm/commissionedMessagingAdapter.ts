import type {
  AdapterEvidence,
  CrmAdapter,
  OutboundMessageInput,
} from "./types";

function customMessageExecution(
  base: CrmAdapter,
  actionName: "sendSms" | "sendWhatsApp",
  input: OutboundMessageInput
): Promise<AdapterEvidence> {
  if (!base.executeCustomAction)
    throw new Error(
      "CRM_ACTION_NOT_AVAILABLE: the commissioned CRM messaging operation is unavailable."
    );
  if (!input.senderIdentity?.trim())
    throw new Error(
      `SENDER_NOT_COMMISSIONED: an exact approved ${actionName === "sendSms" ? "SMS" : "WhatsApp"} sender identity is required.`
    );
  if (!input.idempotencyKey?.trim())
    throw new Error(
      "MESSAGE_IDEMPOTENCY_REQUIRED: a stable proposal-level idempotency key is required before CRM messaging execution."
    );
  return base.executeCustomAction({
    connection: input.connection,
    secret: input.secret,
    actionName,
    payload: {
      to: input.to,
      subject: input.subject || "",
      body: input.body,
      message: input.body,
      templateName: input.templateName || "",
      contactExternalId: input.contactExternalId || "",
      opportunityExternalId: input.opportunityExternalId || "",
      senderIdentity: input.senderIdentity.trim(),
      idempotencyKey: input.idempotencyKey.trim(),
    },
    correlationId: input.correlationId,
  });
}

/**
 * Browser/sidecar CRM messaging must carry the exact commissioned sender and
 * the stable proposal idempotency key into the deterministic learned operation.
 * This wrapper keeps that requirement at the adapter boundary, where it cannot
 * be lost by an older generic message helper.
 */
export function withCommissionedMessagingIdentity(base: CrmAdapter): CrmAdapter {
  return {
    ...base,
    sendSms: input => customMessageExecution(base, "sendSms", input),
    sendWhatsApp: input => customMessageExecution(base, "sendWhatsApp", input),
  };
}
