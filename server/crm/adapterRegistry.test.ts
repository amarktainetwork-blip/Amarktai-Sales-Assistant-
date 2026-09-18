import { afterEach, describe, expect, it } from "vitest";
import { listCrmProviderAvailability } from "./adapterRegistry";

const keys = [
  "BROWSERLESS_WS_ENDPOINT",
  "HUBSPOT_CLIENT_ID",
  "HUBSPOT_CLIENT_SECRET",
  "SALESFORCE_CLIENT_ID",
  "SALESFORCE_CLIENT_SECRET",
  "PIPEDRIVE_CLIENT_ID",
  "PIPEDRIVE_CLIENT_SECRET",
  "ZOHO_CLIENT_ID",
  "ZOHO_CLIENT_SECRET",
] as const;
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("CRM provider availability", () => {
  it("never advertises an OAuth connector as ready without both platform credentials", () => {
    for (const key of keys) delete process.env[key];
    process.env.HUBSPOT_CLIENT_ID = "id-only";
    const result = listCrmProviderAvailability();
    expect(result.find(item => item.provider === "hubspot")?.configured).toBe(
      false
    );
    expect(
      result.find(item => item.provider === "salesforce")?.configured
    ).toBe(false);
    expect(result.find(item => item.provider === "pipedrive")?.configured).toBe(
      false
    );
    expect(result.find(item => item.provider === "zoho")?.configured).toBe(
      false
    );
  });

  it("reports configured OAuth and browser connectors without exposing secrets", () => {
    process.env.BROWSERLESS_WS_ENDPOINT = "ws://browser:9222";
    process.env.HUBSPOT_CLIENT_ID = "client";
    process.env.HUBSPOT_CLIENT_SECRET = "secret";
    const result = listCrmProviderAvailability();
    expect(result.find(item => item.provider === "genie")?.configured).toBe(
      true
    );
    expect(
      result.find(item => item.provider === "custom_browser")?.configured
    ).toBe(true);
    expect(result.find(item => item.provider === "hubspot")?.configured).toBe(
      true
    );
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
