import { describe, expect, it } from "vitest";
import {
  genieInteractiveAuthIsFresh,
  validateGenieVerificationCode,
} from "./genieInteractiveAuth";

describe("Genie interactive authentication", () => {
  it("accepts normal verification codes without persisting or transforming them", () => {
    expect(validateGenieVerificationCode("123456")).toBe("123456");
    expect(validateGenieVerificationCode("AB12-CD34")).toBe("AB12-CD34");
  });

  it("rejects empty, oversized, and unsafe verification values", () => {
    expect(() => validateGenieVerificationCode("")).toThrow(
      "GENIE_VERIFICATION_CODE_INVALID"
    );
    expect(() => validateGenieVerificationCode("123456<script>")).toThrow(
      "GENIE_VERIFICATION_CODE_INVALID"
    );
    expect(() => validateGenieVerificationCode("123456789012345678901")).toThrow(
      "GENIE_VERIFICATION_CODE_INVALID"
    );
  });

  it("expires pending interactive authentication after fifteen minutes", () => {
    const createdAt = "2026-08-24T20:00:00.000Z";
    const pending = {
      browserSession: {},
      challengeUrl: "https://genie.entrepreneurscircle.org/verify",
      createdAt,
    };
    expect(
      genieInteractiveAuthIsFresh(
        pending,
        new Date("2026-08-24T20:14:59.000Z").getTime()
      )
    ).toBe(true);
    expect(
      genieInteractiveAuthIsFresh(
        pending,
        new Date("2026-08-24T20:15:01.000Z").getTime()
      )
    ).toBe(false);
  });
});
