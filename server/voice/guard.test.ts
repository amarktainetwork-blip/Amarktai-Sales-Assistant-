import { describe, expect, it } from "vitest";
import { assertTtsGenerationAllowed } from "./guard";
describe("TTS governance", () => { it("requires recorded consent, an active voice, and approved text", () => {
  expect(() => assertTtsGenerationAllowed({ consentStatus: "recorded", isActive: true, requestStatus: "approved" })).not.toThrow();
  expect(() => assertTtsGenerationAllowed({ consentStatus: "revoked", isActive: true, requestStatus: "approved" })).toThrow("TTS_VOICE_CONSENT_REQUIRED");
  expect(() => assertTtsGenerationAllowed({ consentStatus: "recorded", isActive: true, requestStatus: "draft" })).toThrow("TTS_REQUEST_REVIEW_REQUIRED");
}); });
