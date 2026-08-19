import type { CrmAdapter, CrmProvider } from "./types";
import { hubspotAdapter } from "./hubspot";
import { salesforceAdapter } from "./salesforce";
import { pipedriveAdapter } from "./pipedrive";
import { zohoAdapter } from "./zoho";
import { browserCrmAdapter } from "../browserConnectors/browserCrmAdapter";

const adapters: Partial<Record<CrmProvider, CrmAdapter>> = {
  hubspot: hubspotAdapter,
  salesforce: salesforceAdapter,
  pipedrive: pipedriveAdapter,
  zoho: zohoAdapter,
  genie: browserCrmAdapter("genie"),
  custom_browser: browserCrmAdapter("custom_browser"),
};

export function getCrmAdapter(provider: CrmProvider): CrmAdapter {
  const adapter = adapters[provider];
  if (!adapter) throw new Error(`The ${provider} adapter is not installed in this deployment. Configure a supported connector before attempting this operation.`);
  return adapter;
}

export function listInstalledCrmAdapters() {
  return Object.entries(adapters).filter((entry): entry is [CrmProvider, CrmAdapter] => Boolean(entry[1])).map(([provider]) => provider);
}
