import { createHmac, timingSafeEqual } from "node:crypto";

export type WebhookSignatureStatus = "verified" | "missing" | "invalid" | "not_configured";

export function verifyWebhookSignature(input: { payload: string; signature?: string | null; secret?: string | null; algorithm?: "sha256" | "sha512" | null }): WebhookSignatureStatus {
  if (!input.secret || !input.algorithm) return "not_configured";
  if (!input.signature) return "missing";
  const expected = createHmac(input.algorithm, input.secret).update(input.payload).digest("hex");
  const received = input.signature.trim().replace(/^sha(?:256|512)=/i, "");
  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(received, "hex");
  if (expectedBuffer.length !== receivedBuffer.length) return "invalid";
  return timingSafeEqual(expectedBuffer, receivedBuffer) ? "verified" : "invalid";
}

export function webhookReceiptDisposition(signatureStatus: WebhookSignatureStatus) {
  return signatureStatus === "verified" ? "received" as const : "ignored" as const;
}
