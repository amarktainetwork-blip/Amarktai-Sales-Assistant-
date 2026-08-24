import { describe, expect, it } from "vitest";
import { validateBrowserProfile } from "./connectedSystemAdminRoutes";

describe("browser profile secret boundary", () => {
  it("accepts selector-only calibration and rejects credentials or session material", () => {
    expect(
      validateBrowserProfile({
        login: {
          usernameSelector: 'input[name="username"]',
          passwordSelector: 'input[type="password"]',
          submitSelector: 'button[type="submit"]',
          readySelector: '[data-testid="dashboard"]',
        },
      })
    ).toBeTruthy();
    for (const profile of [
      { credentials: { username: "secret" } },
      { password: "secret" },
      { storageState: { cookies: [] } },
      { nested: { browserSession: {} } },
    ])
      expect(() => validateBrowserProfile(profile)).toThrow(
        /never credentials or session material/i
      );
  });
});
