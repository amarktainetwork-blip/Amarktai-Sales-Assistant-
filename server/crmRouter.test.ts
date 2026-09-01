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
  it("routes only through a usable system with backend-verified capabilities", () => {
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
          "notes.write",
          "activities.write",
        ],
      },
      {
        id: 2,
        provider: "genie",
        displayName: "Genie",
        status: "needs_attention",
        connectionMethod: "browser",
        verifiedCapabilities: ["sms.send", "activities.write"],
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

  it("routes an independently verified function on a limited connection", () => {
    const systems = [
      {
        id: 2,
        provider: "genie",
        displayName: "Genie",
        status: "limited_permissions",
        connectionMethod: "browser",
        verifiedCapabilities: ["sms.send"],
      },
    ];
    const [sms] = routeConnectedSystemActions(
      [{ actionType: "send_sms", payload: {} }],
      systems
    );
    expect(sms.payload.crmRoute).toMatchObject({
      routable: true,
      connectedSystemId: 2,
      requiredCapability: "sms.send",
    });
  });

  it("does not require an unrelated capability for a CRM communication function", () => {
    const systems = [
      {
        id: 3,
        provider: "genie",
        displayName: "Genie",
        status: "ready",
        connectionMethod: "browser",
        verifiedCapabilities: ["whatsapp.send"],
      },
    ];
    expect(connectedSystemSupportsAction(systems[0], "send_whatsapp")).toBe(true);
  });

  it("blocks communication where no usable connector has the exact verified path", () => {
    const systems = [
      {
        id: 1,
        provider: "hubspot",
        displayName: "HubSpot",
        status: "ready",
        connectionMethod: "oauth",
        verifiedCapabilities: ["contacts.read"],
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

  it("blocks a ready-labelled browser connector when verification did not record the required standard capability", () => {
    const systems = [
      {
        id: 9,
        provider: "custom_browser",
        displayName: "Other CRM",
        status: "ready",
        connectionMethod: "browser",
        verifiedCapabilities: [],
      },
    ];
    const [proposal] = routeConnectedSystemActions(
      [{ actionType: "update_contact", payload: {} }],
      systems
    );
    expect(proposal.payload.crmRoute).toMatchObject({
      routable: false,
      reason: expect.stringContaining("backend-verified"),
    });
  });

  it("honours a preferred provider only when that verified connector can perform the action", () => {
    const systems = [
      {
        id: 1,
        provider: "hubspot",
        displayName: "HubSpot",
        status: "ready",
        connectionMethod: "oauth",
        verifiedCapabilities: ["contacts.write"],
      },
      {
        id: 2,
        provider: "salesforce",
        displayName: "Salesforce",
        status: "ready",
        connectionMethod: "oauth",
        verifiedCapabilities: ["contacts.write"],
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

  it("routes inherited call context to the exact connected system before considering provider", () => {
    const systems = [
      {
        id: 11,
        provider: "custom_browser",
        displayName: "Other CRM",
        status: "ready",
        connectionMethod: "browser",
        verifiedCapabilities: ["notes.write"],
      },
      {
        id: 12,
        provider: "custom_browser",
        displayName: "Genie",
        status: "ready",
        connectionMethod: "browser",
        verifiedCapabilities: ["notes.write"],
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

  it("routes calendar creation only when delegated Microsoft connection is configured", () => {
    const keys = [
      "OUTLOOK_DELEGATED_TENANT_ID",
      "OUTLOOK_DELEGATED_CLIENT_ID",
      "OUTLOOK_DELEGATED_CLIENT_SECRET",
      "OUTLOOK_DELEGATED_REDIRECT_URI",
      "PUBLIC_APP_URL",
      "OUTLOOK_TENANT_ID",
      "OUTLOOK_CLIENT_ID",
      "OUTLOOK_CLIENT_SECRET",
    ] as const;
    const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    try {
      for (const key of keys) delete process.env[key];
      const [blocked] = routeConnectedSystemActions(
        [{ actionType: "create_calendar_event", payload: {} }],
        []
      );
      expect(blocked.payload.crmRoute).toMatchObject({
        routable: false,
        requiredCapability: "Calendars.ReadWrite",
      });

      process.env.OUTLOOK_DELEGATED_TENANT_ID = "common";
      process.env.OUTLOOK_DELEGATED_CLIENT_ID = "client";
      process.env.OUTLOOK_DELEGATED_CLIENT_SECRET = "secret";
      process.env.OUTLOOK_DELEGATED_REDIRECT_URI =
        "https://sales.example.test/api/mailbox/microsoft/callback";
      const [ready] = routeConnectedSystemActions(
        [{ actionType: "create_calendar_event", payload: {} }],
        []
      );
      expect(ready.payload.crmRoute).toMatchObject({
        routable: true,
        provider: "microsoft_delegated",
        connectionMode: "delegated_oauth",
        requiredCapability: "Calendars.ReadWrite",
      });
    } finally {
      for (const key of keys) {
        const value = previous[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
