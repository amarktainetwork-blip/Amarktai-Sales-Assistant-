import { describe, expect, it } from "vitest";
import { routeCrmCapability, routeWorkflowActions } from "./crmRouter";

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
  it("marks an unroutable workflow proposal as blocked at routing time", () => {
    const [proposal] = routeWorkflowActions([{ actionType: "update_current_opportunity", payload: { reviewRequired: true } }], [readyBrowserCrm]);
    expect(proposal.payload.crmRoute).toMatchObject({ routable: false, requiredCapability: "opportunities" });
  });
  it("attaches the CRM workspace bridge route when the matching capability is ready", () => {
    const [proposal] = routeWorkflowActions([{ actionType: "append_contact_note", payload: {} }], [readyBrowserCrm]);
    expect(proposal.payload.crmRoute).toMatchObject({ routable: true, provider: "genie", requiredCapability: "notes" });
  });
});
