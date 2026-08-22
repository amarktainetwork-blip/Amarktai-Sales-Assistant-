export function assertTtsGenerationAllowed(input: { consentStatus: "not_recorded" | "recorded" | "revoked"; isActive: boolean; requestStatus: "draft" | "approved" | "generated" | "failed" | "cancelled" }) {
  if (input.consentStatus !== "recorded" || !input.isActive) throw new Error("TTS_VOICE_CONSENT_REQUIRED");
  if (input.requestStatus !== "approved") throw new Error("TTS_REQUEST_REVIEW_REQUIRED");
}
