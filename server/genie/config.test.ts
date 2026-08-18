import { afterEach, describe, expect, it } from "vitest";
import { getGenieReadiness } from "./config";

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
});

describe("Genie browser bridge configuration", () => {
  it("requires a login URL, credentials, and browser endpoint without requiring an API key", () => {
    delete process.env.GENIE_LOGIN_URL;
    delete process.env.GENIE_USERNAME;
    delete process.env.GENIE_PASSWORD;
    delete process.env.BROWSERLESS_WS_ENDPOINT;
    delete process.env.GENIE_CRM_API_KEY;

    const readiness = getGenieReadiness();

    expect(readiness.mode).toBe("browser_automation");
    expect(readiness.missing).toEqual(expect.arrayContaining(["GENIE_LOGIN_URL", "GENIE_USERNAME", "GENIE_PASSWORD", "BROWSERLESS_WS_ENDPOINT"]));
    expect(readiness.missing).not.toContain("GENIE_CRM_API_KEY");
  });
});
