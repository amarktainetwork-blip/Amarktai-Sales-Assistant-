import { describe, expect, it } from "vitest";
import { connectedSystemSupportsAction, routeConnectedSystemActions, routeCrmCapability, routeWorkflowActions } from "./crmRouter";

const readyBrowserCrm = { provider: "genie" as const, displayName: "CRM workspace bridge", status: "ready" as const, capabilities: ["contacts", "notes", "tasks"] as const, connectionMode: "browser_automation" as const };

describe("multi-CRM capability router", () => {
  it("routes only to a ready legacy connection with the required capability", () => {
    expect(routeCrmCapability({ connections: [readyBrowserCrm], requiredCapability: "notes" })).toMatchObject({ routable: true, provider: "genie", connectionMode: "browser_automation" });
  });
  it("rejects a missing legacy capability instead of inventing a provider", () => {
    expect(routeCrmCapability({ connections: [readyBrowserCrm], requiredCapability: "opportunities" })).toMatchObject({ routable: false, reason: expect.stringContaining("opportunities") });
  });
  it("honours a preferred legacy provider only when that provider is ready", () => {
    const result = routeCrmCapability({ connections: [readyBrowserCrm, { provider: "hubspot" as const, displayName: "HubSpot", status: "ready" as const, capabilities: ["tasks"] as const, connectionMode: "api" as const }], requiredCapability: "tasks", preferredProvider: "hubspot" });
    expect(result).toMatchObject({ routable: true, provider: "hubspot" });
  });
  it("defers old playbooks to organisation-scoped connected systems when the legacy registry has no route", () => {
    const [proposal] = routeWorkflowActions([{ actionType: "update_current_opportunity", payload: { reviewRequired: true } }], [readyBrowserCrm]);
    expect(proposal.payload.crmRoute).toMatchObject({ routable: true, provider: "auto", deferredToOrganisationConnector: true, requiredCapability: "opportunities" });
  });
  it("preserves the legacy route when it is genuinely ready", () => {
    const [proposal] = routeWorkflowActions([{ actionType: "append_contact_note", payload: {} }], [readyBrowserCrm]);
    expect(proposal.payload.crmRoute).toMatchObject({ routable: true, provider: "genie", requiredCapability: "notes" });
  });
  it("routes new actions only through ready systems with verified capabilities", () => {
    const systems = [
      { id: 1, provider: "hubspot", displayName: "HubSpot", status: "ready", connectionMethod: "oauth", verifiedCapabilities: ["contacts.read", "contacts.write", "notes.write", "activities.write"] },
      { id: 2, provider: "genie", displayName: "Genie", status: "needs_attention", connectionMethod: "browser", verifiedCapabilities: ["sms.send", "activities.write"] },
    ];
    const [note] = routeConnectedSystemActions([{ actionType: "append_contact_note", payload: {} }], systems);
    expect(note.payload.crmRoute).toMatchObject({ routable: true, provider: "hubspot", connectedSystemId: 1 });
    expect(connectedSystemSupportsAction(systems[0], "append_contact_note")).toBe(true);
  });
  it("fails routing when no ready connected system has an allowed communication path", () => {
    const systems = [{ id: 1, provider: "hubspot", displayName: "HubSpot", status: "ready", connectionMethod: "oauth", verifiedCapabilities: ["contacts.read"] }];
    const [sms] = routeConnectedSystemActions([{ actionType: "send_sms", payload: {} }], systems);
    expect(sms.payload.crmRoute).toMatchObject({ routable: false, requiredCapability: expect.stringContaining("sms.send") });
  });
  it("blocks a ready-labelled connector when backend verification did not record the action capability", () => {
    const systems = [{ id: 9, provider: "custom_api", displayName: "Unverified adapter", status: "ready", connectionMethod: "custom_adapter", verifiedCapabilities: [] }];
    const [proposal] = routeConnectedSystemActions([{ actionType: "update_contact", payload: {} }], systems);
    expect(proposal.payload.crmRoute).toMatchObject({ routable: false, reason: expect.stringContaining("backend-verified") });
  });
});
