import { describe, expect, it } from "vitest";
import { connectedSystemSupportsAction, routeConnectedSystemActions } from "./crmRouter";

describe("canonical connected-system capability router", () => {
  it("routes only through a ready system with backend-verified capabilities", () => {
    const systems = [
      { id: 1, provider: "hubspot", displayName: "HubSpot", status: "ready", connectionMethod: "oauth", verifiedCapabilities: ["contacts.read", "contacts.write", "notes.write", "activities.write"] },
      { id: 2, provider: "genie", displayName: "Genie", status: "needs_attention", connectionMethod: "browser", verifiedCapabilities: ["sms.send", "activities.write"] },
    ];
    const [note] = routeConnectedSystemActions([{ actionType: "append_contact_note", payload: {} }], systems);
    expect(note.payload.crmRoute).toMatchObject({ routable: true, provider: "hubspot", connectedSystemId: 1 });
    expect(connectedSystemSupportsAction(systems[0], "append_contact_note")).toBe(true);
  });

  it("blocks communication where no ready connector has an allowed path", () => {
    const systems = [{ id: 1, provider: "hubspot", displayName: "HubSpot", status: "ready", connectionMethod: "oauth", verifiedCapabilities: ["contacts.read"] }];
    const [sms] = routeConnectedSystemActions([{ actionType: "send_sms", payload: {} }], systems);
    expect(sms.payload.crmRoute).toMatchObject({ routable: false, requiredCapability: expect.stringContaining("sms.send") });
  });

  it("blocks a ready-labelled connector when backend verification did not record the action capability", () => {
    const systems = [{ id: 9, provider: "custom_api", displayName: "Unverified adapter", status: "ready", connectionMethod: "custom_adapter", verifiedCapabilities: [] }];
    const [proposal] = routeConnectedSystemActions([{ actionType: "update_contact", payload: {} }], systems);
    expect(proposal.payload.crmRoute).toMatchObject({ routable: false, reason: expect.stringContaining("backend-verified") });
  });

  it("honours a preferred provider only when that verified connector can perform the action", () => {
    const systems = [
      { id: 1, provider: "hubspot", displayName: "HubSpot", status: "ready", connectionMethod: "oauth", verifiedCapabilities: ["contacts.write"] },
      { id: 2, provider: "salesforce", displayName: "Salesforce", status: "ready", connectionMethod: "oauth", verifiedCapabilities: ["contacts.write"] },
    ];
    const [proposal] = routeConnectedSystemActions([{ actionType: "update_contact", payload: { preferredProvider: "salesforce" } }], systems);
    expect(proposal.payload.crmRoute).toMatchObject({ routable: true, provider: "salesforce", connectedSystemId: 2 });
  });
});
