import { verifyWebhookSignature, webhookReceiptDisposition, type WebhookSignatureStatus } from "./webhookSecurity";

export type WebhookConnectorState = {
  status: string;
  verifiedCapabilities: string[];
  webhookSecret?: string | null;
  webhookAlgorithm?: "sha256" | "sha512" | null;
};

export type WebhookIntakeDecision = {
  signatureStatus: WebhookSignatureStatus;
  processingStatus: "received" | "ignored";
  reason?: "CONNECTOR_NOT_READY" | "WEBHOOK_CAPABILITY_UNVERIFIED";
};

export function assessWebhookIntake(state: WebhookConnectorState, payload: string, signature?: string | null): WebhookIntakeDecision {
  if (state.status !== "ready") return { signatureStatus: "not_configured", processingStatus: "ignored", reason: "CONNECTOR_NOT_READY" };
  if (!state.verifiedCapabilities.includes("webhook_inbound")) return { signatureStatus: "not_configured", processingStatus: "ignored", reason: "WEBHOOK_CAPABILITY_UNVERIFIED" };
  const signatureStatus = verifyWebhookSignature({ payload, signature, secret: state.webhookSecret, algorithm: state.webhookAlgorithm });
  return { signatureStatus, processingStatus: webhookReceiptDisposition(signatureStatus) };
}
