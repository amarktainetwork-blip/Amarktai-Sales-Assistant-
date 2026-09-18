import type { CrmAdapter, CrmProvider, OutboundMessageInput } from "./types";
import { hubspotExtendedAdapter } from "./hubspotExtended";
import { salesforceAdapter } from "./salesforce";
import { pipedriveAdapter } from "./pipedrive";
import { zohoAdapter } from "./zoho";
import { browserCrmAdapter } from "../browserConnectors/browserCrmAdapter";

function browserAdapter(
  provider: Extract<CrmProvider, "genie" | "custom_browser">
): CrmAdapter {
  const base = browserCrmAdapter(provider);
  const message = (
    actionName: "sendSms" | "sendWhatsApp",
    input: OutboundMessageInput
  ) => {
    if (!base.executeCustomAction)
      throw new Error(
        `${provider} does not expose the commissioned browser action '${actionName}'.`
      );
    if (!input.senderIdentity?.trim())
      throw new Error(
        `SENDER_NOT_COMMISSIONED: ${actionName === "sendSms" ? "SMS" : "WhatsApp"} execution requires the exact approved sender identity.`
      );
    if (!input.idempotencyKey?.trim())
      throw new Error(
        "OUTBOUND_IDEMPOTENCY_REQUIRED: browser messaging requires a stable message idempotency key."
      );
    return base.executeCustomAction({
      connection: input.connection,
      secret: input.secret,
      actionName,
      payload: {
        to: input.to,
        subject: input.subject || "",
        body: input.body,
        message: input.body,
        templateName: input.templateName || "",
        contactExternalId: input.contactExternalId || "",
        opportunityExternalId: input.opportunityExternalId || "",
        senderIdentity: input.senderIdentity,
        idempotencyKey: input.idempotencyKey,
      },
      correlationId: input.correlationId,
    });
  };
  return {
    ...base,
    sendSms: input => message("sendSms", input),
    sendWhatsApp: input => message("sendWhatsApp", input),
  };
}

const adapters: Partial<Record<CrmProvider, CrmAdapter>> = {
  hubspot: hubspotExtendedAdapter,
  salesforce: salesforceAdapter,
  pipedrive: pipedriveAdapter,
  zoho: zohoAdapter,
  genie: browserAdapter("genie"),
  custom_browser: browserAdapter("custom_browser"),
};

export function getCrmAdapter(provider: CrmProvider): CrmAdapter {
  const adapter = adapters[provider];
  if (!adapter)
    throw new Error(
      `The ${provider} adapter is not installed in this deployment. Configure a supported connector before attempting this operation.`
    );
  return adapter;
}

export function listInstalledCrmAdapters() {
  return Object.entries(adapters)
    .filter((entry): entry is [CrmProvider, CrmAdapter] => Boolean(entry[1]))
    .map(([provider]) => provider);
}

function configuredPair(id: string, secret: string) {
  return Boolean(process.env[id]?.trim() && process.env[secret]?.trim());
}

export function listCrmProviderAvailability() {
  const browserRuntime = Boolean(process.env.BROWSERLESS_WS_ENDPOINT?.trim());
  return [
    {
      provider: "genie" as const,
      configured: browserRuntime,
      connectionMethod: "browser" as const,
      reason: browserRuntime
        ? "Secure browser connection is available."
        : "Secure browser runtime is not configured on this deployment.",
    },
    {
      provider: "hubspot" as const,
      configured: configuredPair("HUBSPOT_CLIENT_ID", "HUBSPOT_CLIENT_SECRET"),
      connectionMethod: "oauth" as const,
      reason: configuredPair("HUBSPOT_CLIENT_ID", "HUBSPOT_CLIENT_SECRET")
        ? "OAuth connection is available."
        : "Platform OAuth setup is required before a client can connect HubSpot.",
    },
    {
      provider: "salesforce" as const,
      configured: configuredPair(
        "SALESFORCE_CLIENT_ID",
        "SALESFORCE_CLIENT_SECRET"
      ),
      connectionMethod: "oauth" as const,
      reason: configuredPair("SALESFORCE_CLIENT_ID", "SALESFORCE_CLIENT_SECRET")
        ? "OAuth connection is available."
        : "Platform OAuth setup is required before a client can connect Salesforce.",
    },
    {
      provider: "pipedrive" as const,
      configured: configuredPair(
        "PIPEDRIVE_CLIENT_ID",
        "PIPEDRIVE_CLIENT_SECRET"
      ),
      connectionMethod: "oauth" as const,
      reason: configuredPair("PIPEDRIVE_CLIENT_ID", "PIPEDRIVE_CLIENT_SECRET")
        ? "OAuth connection is available."
        : "Platform OAuth setup is required before a client can connect Pipedrive.",
    },
    {
      provider: "zoho" as const,
      configured: configuredPair("ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET"),
      connectionMethod: "oauth" as const,
      reason: configuredPair("ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET")
        ? "OAuth connection is available."
        : "Platform OAuth setup is required before a client can connect Zoho CRM.",
    },
    {
      provider: "custom_browser" as const,
      configured: browserRuntime,
      connectionMethod: "browser" as const,
      reason: browserRuntime
        ? "Secure browser commissioning is available."
        : "Secure browser runtime is not configured on this deployment.",
    },
  ];
}
