import { describe, expect, it } from "vitest";
import { routeCrmCapability } from "./crmRouter";

const readyBrowserCrm = { provider: "genie" as const, displayName: "CRM workspace bridge", status: "ready" as const, capabilities: ["contacts", "notes", "tasks"] as const, connectionMode: "browser_automation" as const };

describe("multi-CRM capability router", () => {
  it("routes only to a ready connection with the required capability", () => {
    expect(routeCrmCapability({ connections: [readyBrowserCrm], requiredCapability: "notes" })).toMatchObject({ routable: true, provider: "genie", connectionMode: "browser_automation" });
  });
  it("rejects a missing capability instead of inventing a route", () => {
    expect(routeCrmCapability({ connections: [readyBrowserCrm], requiredCapability: "opportunities" })).toMatchObject({ routable: false, reason: expect.stringContaining("opportunities") });
  });
  it("honours a preferred provider only when that provider is ready", () => {
    const result = routeCrmCapability({ connections: [readyBrowserCrm, { provider: "hubspot" as const, displayName: "HubSpot", status: "ready" as const, capabilities: ["tasks"] as const, connectionMode: "api" as const }], requiredCapability: "tasks", preferredProvider: "hubspot" });
    expect(result).toMatchObject({ routable: true, provider: "hubspot" });
  });
});
