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

  it("blocks a ready-labelled browser connector when verification did not record the required capability", () => {
    const systems = [{ id: 9, provider: "custom_browser", displayName: "Other CRM", status: "ready", connectionMethod: "browser", verifiedCapabilities: [] }];
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

  it("routes calendar creation only when the installation-level Outlook boundary is configured", () => {
    const keys = ["OUTLOOK_TENANT_ID", "OUTLOOK_CLIENT_ID", "OUTLOOK_CLIENT_SECRET", "OUTLOOK_SENDER_EMAIL"] as const;
    const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    try {
      for (const key of keys) delete process.env[key];
      const [blocked] = routeConnectedSystemActions([{ actionType: "create_calendar_event", payload: {} }], []);
      expect(blocked.payload.crmRoute).toMatchObject({ routable: false, requiredCapability: "calendar.create" });
      process.env.OUTLOOK_TENANT_ID = "tenant";
      process.env.OUTLOOK_CLIENT_ID = "client";
      process.env.OUTLOOK_CLIENT_SECRET = "secret";
      process.env.OUTLOOK_SENDER_EMAIL = "sales@example.test";
      const [ready] = routeConnectedSystemActions([{ actionType: "create_calendar_event", payload: {} }], []);
      expect(ready.payload.crmRoute).toMatchObject({ routable: true, provider: "outlook", connectionMode: "microsoft_graph" });
    } finally {
      for (const key of keys) {
        const value = previous[key];
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
});
