import { describe, expect, it } from "vitest";
import {
  connectedSystemSupportsAction,
  routeConnectedSystemActions,
} from "./crmRouter";

const liveCustom = {
  operationKey: "custom.write.send.quote",
  label: "Send Quote",
  mode: "write" as const,
  status: "LIVE_PROVEN",
  version: 3,
  lastTestAt: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  productionReady: true,
};

describe("canonical connected-system capability router", () => {
  it("routes only through a usable system with backend-verified write and readback capability", () => {
    const systems = [
      {
        id: 1,
        provider: "hubspot",
        displayName: "HubSpot",
        status: "ready",
        connectionMethod: "oauth",
        verifiedCapabilities: [
          "contacts.read",
          "contacts.write",
          "notes.read",
          "notes.write",
          "activities.read",
          "activities.write",
        ],
      },
      {
        id: 2,
        provider: "genie",
        displayName: "Genie",
        status: "needs_attention",
        connectionMethod: "browser",
        verifiedCapabilities: ["activities.read", "sms.send"],
      },
    ];
    const [note] = routeConnectedSystemActions(
      [{ actionType: "append_contact_note", payload: {} }],
      systems
    );
    expect(note.payload.crmRoute).toMatchObject({
      routable: true,
      provider: "hubspot",
      connectedSystemId: 1,
    });
    expect(connectedSystemSupportsAction(systems[0], "append_contact_note")).toBe(
      true
    );
  });

  it("does not route an SMS send without the activity read capability needed for duplicate preflight", () => {
    const system = {
      id: 2,
      provider: "genie",
      displayName: "Genie",
      status: "limited_permissions",
      connectionMethod: "browser",
      verifiedCapabilities: ["sms.send"],
    };
    const [sms] = routeConnectedSystemActions(
      [{ actionType: "send_sms", payload: {} }],
      [system]
    );
    expect(sms.payload.crmRoute).toMatchObject({
      routable: false,
      requiredCapability: "activities.read+sms.send",
    });
    expect(connectedSystemSupportsAction(system, "send_sms")).toBe(false);
  });

  it("routes an independently verified communication only when send and duplicate-read capabilities are ready", () => {
    const system = {
      id: 3,
      provider: "genie",
      displayName: "Genie",
      status: "limited_permissions",
      connectionMethod: "browser",
      verifiedCapabilities: ["activities.read", "whatsapp.send"],
    };
    const [proposal] = routeConnectedSystemActions(
      [{ actionType: "send_whatsapp", payload: {} }],
      [system]
    );
    expect(proposal.payload.crmRoute).toMatchObject({
      routable: true,
      connectedSystemId: 3,
      requiredCapability: "activities.read+whatsapp.send",
    });
  });

  it("requires read and write capability for mutable existing records", () => {
    const writeOnly = {
      id: 4,
      provider: "salesforce",
      displayName: "Salesforce",
      status: "ready",
      connectionMethod: "oauth",
      verifiedCapabilities: ["tasks.write", "opportunities.write"],
    };
    expect(connectedSystemSupportsAction(writeOnly, "complete_active_task")).toBe(
      false
    );
    expect(
      connectedSystemSupportsAction(writeOnly, "update_current_opportunity")
    ).toBe(false);
    const readWrite = {
      ...writeOnly,
      verifiedCapabilities: [
        "tasks.read",
        "tasks.write",
        "opportunities.read",
        "opportunities.write",
      ],
    };
    expect(connectedSystemSupportsAction(readWrite, "complete_active_task")).toBe(
      true
    );
    expect(
      connectedSystemSupportsAction(readWrite, "update_current_opportunity")
    ).toBe(true);
  });

  it("blocks communication where no usable connector has the exact verified path", () => {
    const systems = [
      {
        id: 1,
        provider: "hubspot",
        displayName: "HubSpot",
        status: "ready",
        connectionMethod: "oauth",
        verifiedCapabilities: ["contacts.read", "activities.read"],
      },
    ];
    const [sms] = routeConnectedSystemActions(
      [{ actionType: "send_sms", payload: {} }],
      systems
    );
    expect(sms.payload.crmRoute).toMatchObject({
      routable: false,
      requiredCapability: expect.stringContaining("sms.send"),
    });
  });

  it("routes a custom-only limited browser connector when the exact operation is LIVE_PROVEN", () => {
    const systems = [
      {
        id: 5,
        provider: "hubspot",
        displayName: "HubSpot",
        status: "ready",
        connectionMethod: "oauth",
        verifiedCapabilities: ["activities.write"],
        learnedOperations: [],
      },
      {
        id: 6,
        provider: "genie",
        displayName: "Genie",
        status: "limited_permissions",
        connectionMethod: "browser",
        verifiedCapabilities: [],
        learnedOperations: [liveCustom],
      },
    ];
    const [custom] = routeConnectedSystemActions(
      [
        {
          actionType: "custom_crm_action",
          payload: {
            actionName: "custom.write.send.quote",
            preferredConnectedSystemId: 6,
          },
        },
      ],
      systems
    );
    expect(custom.payload.crmRoute).toMatchObject({
      routable: true,
      connectedSystemId: 6,
      operationKey: "custom.write.send.quote",
      operationState: "LIVE_PROVEN",
    });
    expect(
      connectedSystemSupportsAction(
        systems[1],
        "custom_crm_action",
        "custom.write.send.quote"
      )
    ).toBe(true);
    expect(
      connectedSystemSupportsAction(
        systems[0],
        "custom_crm_action",
        "custom.write.send.quote"
      )
    ).toBe(false);
  });

  it("does not route an unknown or TEST_READY custom operation in production", () => {
    const system = {
      id: 6,
      provider: "genie",
      displayName: "Genie",
      status: "limited_permissions",
      connectionMethod: "browser",
      verifiedCapabilities: [],
      learnedOperations: [
        { ...liveCustom, status: "TEST_READY", productionReady: false },
      ],
    };
    for (const actionName of [
      "custom.write.send.quote",
      "custom.write.not.learned",
      "send.quote",
    ]) {
      const [custom] = routeConnectedSystemActions(
        [
          {
            actionType: "custom_crm_action",
            payload: { actionName, preferredConnectedSystemId: 6 },
          },
        ],
        [system]
      );
      expect(custom.payload.crmRoute).toMatchObject({ routable: false });
    }
  });

  it("honours a preferred provider only when that verified connector can perform the governed action", () => {
    const systems = [
      {
        id: 1,
        provider: "hubspot",
        displayName: "HubSpot",
        status: "ready",
        connectionMethod: "oauth",
        verifiedCapabilities: ["contacts.read", "contacts.write"],
      },
      {
        id: 2,
        provider: "salesforce",
        displayName: "Salesforce",
        status: "ready",
        connectionMethod: "oauth",
        verifiedCapabilities: ["contacts.read", "contacts.write"],
      },
    ];
    const [proposal] = routeConnectedSystemActions(
      [
        {
          actionType: "update_contact",
          payload: { preferredProvider: "salesforce" },
        },
      ],
      systems
    );
    expect(proposal.payload.crmRoute).toMatchObject({
      routable: true,
      provider: "salesforce",
      connectedSystemId: 2,
    });
  });

  it("routes inherited customer context to the exact connected system before provider preference", () => {
    const systems = [
      {
        id: 11,
        provider: "custom_browser",
        displayName: "Other CRM",
        status: "ready",
        connectionMethod: "browser",
        verifiedCapabilities: ["notes.read", "notes.write"],
      },
      {
        id: 12,
        provider: "custom_browser",
        displayName: "Genie",
        status: "ready",
        connectionMethod: "browser",
        verifiedCapabilities: ["notes.read", "notes.write"],
      },
    ];
    const [note] = routeConnectedSystemActions(
      [
        {
          actionType: "append_contact_note",
          payload: {
            preferredConnectedSystemId: 12,
            preferredProvider: "custom_browser",
          },
        },
      ],
      systems
    );
    expect(note.payload.crmRoute).toMatchObject({
      routable: true,
      connectedSystemId: 12,
      displayName: "Genie",
    });
  });

  it("never treats deployment Microsoft OAuth configuration as a personal action route", () => {
    const [blocked] = routeConnectedSystemActions(
      [{ actionType: "send_email", payload: {} }],
      [],
      {
        personalMicrosoft: {
          connected: false,
          scopes: [],
        },
      }
    );
    expect(blocked.payload.crmRoute).toMatchObject({
      routable: false,
      connectionMode: "per_user_delegated_oauth",
      requiredCapability: "Mail.Read + Mail.Send",
    });
  });

  it("requires the current user mailbox to have both Mail.Read and Mail.Send", () => {
    const [missingRead] = routeConnectedSystemActions(
      [{ actionType: "send_email", payload: {} }],
      [],
      {
        personalMicrosoft: {
          connected: true,
          scopes: ["Mail.Send"],
          mailbox: "salesperson@example.test",
        },
      }
    );
    expect(missingRead.payload.crmRoute).toMatchObject({
      routable: false,
      reason: expect.stringContaining("Mail.Read"),
    });

    const [ready] = routeConnectedSystemActions(
      [{ actionType: "send_email", payload: {} }],
      [],
      {
        personalMicrosoft: {
          connected: true,
          scopes: ["mail.read", "MAIL.SEND"],
          mailbox: "salesperson@example.test",
        },
      }
    );
    expect(ready.payload.crmRoute).toMatchObject({
      routable: true,
      provider: "microsoft_delegated",
      connectionMode: "per_user_delegated_oauth",
      requiredCapability: "Mail.Read + Mail.Send",
      mailbox: "salesperson@example.test",
    });
  });

  it("routes calendar only for the current user delegated calendar scope", () => {
    const [blocked] = routeConnectedSystemActions(
      [{ actionType: "create_calendar_event", payload: {} }],
      [],
      { personalMicrosoft: { connected: true, scopes: ["Mail.Send"] } }
    );
    expect(blocked.payload.crmRoute).toMatchObject({
      routable: false,
      requiredCapability: "Calendars.ReadWrite",
    });

    const [ready] = routeConnectedSystemActions(
      [{ actionType: "create_calendar_event", payload: {} }],
      [],
      {
        personalMicrosoft: {
          connected: true,
          scopes: ["Calendars.ReadWrite"],
          mailbox: "salesperson@example.test",
        },
      }
    );
    expect(ready.payload.crmRoute).toMatchObject({
      routable: true,
      provider: "microsoft_delegated",
      connectionMode: "per_user_delegated_oauth",
      requiredCapability: "Calendars.ReadWrite",
    });
  });
});
