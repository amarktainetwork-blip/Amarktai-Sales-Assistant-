import { runGenieHealthCheck } from "../genie/bridge";
import type { AdapterConnection, AdapterEvidence, CapabilityResult, ConnectionSecretPayload, ConnectionTest, CrmAdapter, CrmProvider } from "../crm/types";

const browserCapabilities: CapabilityResult[] = [
  "contacts.read", "contacts.write", "companies.read", "companies.write", "opportunities.read", "opportunities.write", "tasks.read", "tasks.write", "activities.read", "activities.write", "notes.read", "notes.write",
].map(capability => ({ capability: capability as CapabilityResult["capability"], available: false, detail: "Requires a reviewed, deterministic browser connector script and successful capability verification." }));

function evidence(operation: string, correlationId: string, detail: string, errorClassification: AdapterEvidence["errorClassification"] = "validation"): AdapterEvidence {
  return { operation, correlationId, completedAt: new Date().toISOString(), errorClassification, retryable: false, providerResult: { detail } };
}

function unconfigured(operation: string): never {
  throw new Error(`The browser CRM adapter cannot ${operation} until an administrator completes connector calibration and backend capability verification.`);
}

export function browserCrmAdapter(provider: Extract<CrmProvider, "genie" | "custom_browser">): CrmAdapter {
  const testConnection = async (input: { connection: AdapterConnection; correlationId: string }): Promise<ConnectionTest> => {
    if (provider === "genie") {
      const health = await runGenieHealthCheck();
      const capabilities = browserCapabilities.map(item => ({ ...item, available: health.success && input.connection.verifiedCapabilities.includes(item.capability), detail: health.success && input.connection.verifiedCapabilities.includes(item.capability) ? "Verified through calibrated Genie browser connector." : item.detail }));
      return {
        status: health.success ? (capabilities.some(capability => capability.available) ? "ready" : "limited") : "failed",
        summary: health.detail,
        capabilities,
        evidence: [{ operation: "browser_login_health_check", correlationId: input.correlationId, completedAt: health.completedAt, screenshotPath: undefined, providerResult: { success: health.success, detail: health.detail }, errorClassification: health.success ? undefined : "authentication", retryable: !health.success }],
      };
    }
    return {
      status: "failed",
      summary: "No calibrated browser connector profile is available for this system.",
      capabilities: browserCapabilities,
      evidence: [evidence("browser_profile_verification", input.correlationId, "Missing calibrated connector profile.")],
    };
  };

  return {
    provider,
    disconnect: async input => evidence("disconnect", input.correlationId, "Browser-session revocation must be handled by clearing the persisted encrypted session."),
    refreshAuthentication: async input => {
      unconfigured("refresh authentication");
      return input.secret;
    },
    testConnection,
    discoverCapabilities: async input => (await testConnection(input)).capabilities,
    syncContacts: async () => unconfigured("synchronize contacts"),
    syncCompanies: async () => unconfigured("synchronize companies"),
    syncOpportunities: async () => unconfigured("synchronize opportunities"),
    syncTasks: async () => unconfigured("synchronize tasks"),
    syncActivities: async () => unconfigured("synchronize activities"),
    searchContacts: async () => unconfigured("search contacts"),
    getContact: async () => unconfigured("read contacts"),
    getCompany: async () => unconfigured("read companies"),
    getOpportunity: async () => unconfigured("read opportunities"),
    createNote: async input => { unconfigured("create notes"); return evidence("create_note", input.correlationId, "unreachable"); },
    createTask: async input => { unconfigured("create tasks"); return evidence("create_task", input.correlationId, "unreachable"); },
    completeTask: async input => { unconfigured("complete tasks"); return evidence("complete_task", input.correlationId, "unreachable"); },
    updateContact: async input => { unconfigured("update contacts"); return evidence("update_contact", input.correlationId, "unreachable"); },
    updateOpportunity: async input => { unconfigured("update opportunities"); return evidence("update_opportunity", input.correlationId, "unreachable"); },
    createActivity: async input => { unconfigured("create activities"); return evidence("create_activity", input.correlationId, "unreachable"); },
    listPipelines: async () => unconfigured("list pipelines"),
    healthCheck: testConnection,
  };
}
