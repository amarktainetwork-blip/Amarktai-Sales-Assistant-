import { describe, expect, it } from "vitest";
import { parseLiveCallCompletion } from "./completion";

describe("live-call structured completion", () => {
  it.each(["no_answer", "voicemail", "wrong_number"] as const)(
    "accepts %s with an empty transcript",
    outcome => {
      expect(
        parseLiveCallCompletion({ callSessionId: 41, outcome, transcript: "" })
      ).toEqual({ ok: true, callSessionId: 41, outcome, transcript: "" });
    }
  );

  it("still requires a valid call session and confirmed outcome", () => {
    expect(parseLiveCallCompletion({ callSessionId: 0, transcript: "" })).toEqual(
      { ok: false }
    );
  });
});
