import { describe, expect, it } from "vitest";
import { routeCrmCapability, routeWorkflowActions } from "./crmRouter";

const readyBrowserCrm = { provider: "genie" as const, displayName: "CRM workspace bridge", status: "ready" as const, capabilities: ["contacts", "notes", "tasks"] as const, connectionMode: "browser_automation" as const, verificationExpiresAt: new Date(Date.now() + 60 * 60_000) };

describe("multi-CRM capability router", () => {
  it("routes only to a ready connection with the required capability", () => {
    expect(routeCrmCapability({ connections: [readyBrowserCrm], requiredCapability: "notes" })).toMatchObject({ routable: true, provider: "genie", connectionMode: "browser_automation" });
  });
  it("rejects a missing capability instead of inventing a route", () => {
    expect(routeCrmCapability({ connections: [readyBrowserCrm], requiredCapability: "opportunities" })).toMatchObject({ routable: false, reason: expect.stringContaining("opportunities") });
  });
  it("fails closed for an unimplemented provider even if a profile reports ready", () => {
    const result = routeCrmCapability({ connections: [{ provider: "hubspot" as const, displayName: "HubSpot", status: "ready" as const, capabilities: ["tasks"] as const, connectionMode: "api" as const, verificationExpiresAt: new Date(Date.now() + 60 * 60_000) }], requiredCapability: "tasks" });
    expect(result).toMatchObject({ routable: false, reason: expect.stringContaining("currently verified executable CRM") });
  });
  it("fails closed when the server verification is stale or missing", () => {
    const expired = { ...readyBrowserCrm, verificationExpiresAt: new Date(Date.now() - 1_000) };
    const missing = { ...readyBrowserCrm, verificationExpiresAt: null };
    expect(routeCrmCapability({ connections: [expired], requiredCapability: "tasks" })).toMatchObject({ routable: false });
    expect(routeCrmCapability({ connections: [missing], requiredCapability: "tasks" })).toMatchObject({ routable: false });
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
