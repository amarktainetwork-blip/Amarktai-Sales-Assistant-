import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  automaticRepairStatusAfterProof,
  buildSecretFreeDiscoveryPrompt,
  connectorSupportsTemporaryTestRecord,
  controlledWritePayload,
  coreBrowserCommissioningReady,
  inferBrowserOperationCandidates,
  nextCommissioningState,
  resolveSafeTestContext,
} from "./automaticCommissioning";
import { runDeterministicCrmBatch } from "./deterministicBatch";
import {
  assertCompleteBrowserDefinition,
  findIncompleteBrowserDefinition,
} from "../browserConnectors/scriptEngine";
import type { CrmAdapter } from "./types";

const resolvedSafeContext = {
  mode: "existing" as const,
  reference: "contact-1",
  contactExternalId: "contact-1",
  contactLabel: "Test Customer",
  opportunityExternalId: "opportunity-7",
  taskExternalId: "task-9",
  temporaryRecordCreated: false,
  temporaryRecordCleanup: "not_applicable" as const,
};

const snapshot = {
  pageUrl: "https://crm.example.test/app",
  readOnly: true as const,
  controls: [
    {
      tag: "a",
      role: "link",
      label: "Customers",
      selector: "#customers",
      href: "https://crm.example.test/customers",
    },
    {
      tag: "a",
      role: "link",
      label: "Tasks and callbacks",
      selector: "#tasks",
      href: "https://crm.example.test/tasks",
    },
    {
      tag: "a",
      role: "link",
      label: "Deals and pipeline",
      selector: "#deals",
      href: "https://crm.example.test/deals",
    },
    {
      tag: "button",
      role: "button",
      label: "Send WhatsApp",
      selector: '[data-testid="whatsapp"]',
    },
  ],
};

describe("automatic CRM commissioning product contract", () => {
  it("creates bounded Other CRM candidates without making a CRM write", () => {
    const candidates = inferBrowserOperationCandidates(snapshot);
    expect(candidates.map(item => item.operationKey)).toEqual(
      expect.arrayContaining([
        "contact.search",
        "contact.read",
        "task.list",
        "task.create_callback",
        "opportunity.read",
        "whatsapp.send",
      ])
    );
    expect(snapshot.readOnly).toBe(true);
    expect(JSON.stringify(candidates)).not.toContain("execute");
  });

  it("never accepts credentials or secrets as discovery prompt fields", () => {
    const prompt = buildSecretFreeDiscoveryPrompt(snapshot);
    expect(prompt).toContain("Customers");
    expect(prompt).not.toContain("username");
    expect(prompt).not.toContain("password");
    expect(prompt).not.toContain("s3cr3t");
  });

  it("waits for one authorised test record before controlled writes", () => {
    expect(
      nextCommissioningState({ state: "TEST_SAFE_READS", hasWrites: true })
    ).toBe("AWAIT_SAFE_TEST_RECORD");
    expect(() =>
      controlledWritePayload("note.create", {
        ...resolvedSafeContext,
        contactExternalId: "",
      })
    ).toThrow("SAFE_TEST_CONTACT_REQUIRED");
    expect(() =>
      controlledWritePayload("whatsapp.send", {
        ...resolvedSafeContext,
      })
    ).toThrow("AUTHORISED_TEST_DESTINATION_REQUIRED");
    expect(
      controlledWritePayload("note.create", {
        ...resolvedSafeContext,
      })
    ).toMatchObject({
      contactExternalId: "contact-1",
      opportunityExternalId: undefined,
      taskExternalId: undefined,
      controlledCommissioning: true,
    });
    expect(
      controlledWritePayload("opportunity.update", resolvedSafeContext)
    ).toMatchObject({
      externalId: "opportunity-7",
      opportunityExternalId: "opportunity-7",
      contactExternalId: undefined,
      taskExternalId: undefined,
    });
    expect(
      controlledWritePayload("task.complete", resolvedSafeContext)
    ).toMatchObject({
      externalId: "task-9",
      taskExternalId: "task-9",
      contactExternalId: undefined,
      opportunityExternalId: undefined,
    });
  });

  it("recursively rejects every known placeholder before save or execution", () => {
    const definition = {
      mode: "write",
      execute: { steps: [{ action: "click", selector: "REPLACE_SAVE" }] },
      targetRead: {
        steps: [{ action: "goto", value: "https://replace-with-url" }],
      },
      postconditionRead: { steps: [{ action: "read_text", selector: "" }] },
    };
    expect(
      findIncompleteBrowserDefinition(definition).map(item => item.reason)
    ).toEqual(expect.arrayContaining(["placeholder", "missing_selector"]));
    expect(() => assertCompleteBrowserDefinition(definition)).toThrow(
      "INCOMPLETE_BROWSER_OPERATION"
    );
  });

  it("resolves exact contact/opportunity/task IDs and refuses ambiguous related objects", async () => {
    const contact = {
      externalId: "contact-1",
      companyExternalId: "company-2",
      firstName: "Safe",
      lastName: "Customer",
      email: "safe@example.test",
      raw: {},
    };
    const opportunities = [
      {
        externalId: "opp-1",
        contactExternalId: "contact-1",
        name: "Safe deal",
        raw: {},
      },
    ];
    const tasks = [
      {
        externalId: "task-1",
        contactExternalId: "contact-1",
        title: "Safe task",
        status: "open",
        raw: {},
      },
    ];
    const adapter = {
      searchContacts: vi.fn(async () => [contact]),
      getContact: vi.fn(async () => contact),
      syncOpportunities: vi.fn(async () => ({ records: opportunities })),
      syncTasks: vi.fn(async () => ({ records: tasks })),
    } as unknown as CrmAdapter;
    const context = await resolveSafeTestContext({
      record: { mode: "existing", reference: "safe@example.test" },
      operationKeys: ["opportunity.update", "task.complete"],
      connection: {
        id: 1,
        organisationId: 7,
        provider: "genie",
        displayName: "Genie",
        baseUrl: "https://genie.example.test",
        connectionMethod: "browser",
        allowedReadCapabilities: [],
        allowedWriteCapabilities: [],
        verifiedCapabilities: [
          "contacts.read",
          "opportunities.read",
          "tasks.read",
        ],
        scopes: [],
        configuration: {},
      },
      adapter,
      secret: {},
      correlationId: "safe-context-1",
    });
    expect(context).toMatchObject({
      contactExternalId: "contact-1",
      companyExternalId: "company-2",
      opportunityExternalId: "opp-1",
      taskExternalId: "task-1",
    });
    expect(
      controlledWritePayload("opportunity.update", context)
    ).not.toHaveProperty("taskExternalId", "contact-1");

    adapter.syncOpportunities = vi.fn(async () => ({
      records: [
        ...opportunities,
        {
          externalId: "opp-2",
          contactExternalId: "contact-1",
          name: "Second deal",
          raw: {},
        },
      ],
    }));
    await expect(
      resolveSafeTestContext({
        record: { mode: "existing", reference: "contact-1" },
        operationKeys: ["opportunity.update"],
        connection: {
          id: 1,
          organisationId: 7,
          provider: "genie",
          displayName: "Genie",
          baseUrl: "https://genie.example.test",
          connectionMethod: "browser",
          allowedReadCapabilities: [],
          allowedWriteCapabilities: [],
          verifiedCapabilities: ["contacts.read", "opportunities.read"],
          scopes: [],
          configuration: {},
        },
        adapter,
        secret: {},
        correlationId: "safe-context-2",
      })
    ).rejects.toThrow("SAFE_TEST_OPPORTUNITY_SELECTION_REQUIRED");
  });

  it("creates a temporary contact only when the connector's exact create function is verified", async () => {
    const browserConnection = {
      id: 3,
      organisationId: 7,
      provider: "genie" as const,
      displayName: "Genie",
      baseUrl: "https://genie.example.test",
      connectionMethod: "browser" as const,
      allowedReadCapabilities: ["contacts.read"],
      allowedWriteCapabilities: ["contacts.write"],
      verifiedCapabilities: ["contacts.read", "contacts.write"],
      scopes: [],
      configuration: {},
    };
    const created = {
      externalId: "temporary-contact-77",
      firstName: "Amarktai Setup",
      lastName: "Test",
      raw: {},
    };
    const adapter = {
      createContact: vi.fn(async () => ({
        operation: "create_contact",
        completedAt: new Date().toISOString(),
        correlationId: "temporary",
        providerResult: { externalId: created.externalId },
      })),
      getContact: vi.fn(async () => created),
      searchContacts: vi.fn(async () => [created]),
    } as unknown as CrmAdapter;
    expect(
      connectorSupportsTemporaryTestRecord({
        connection: browserConnection,
        adapter,
        contactCreateLiveProven: false,
      })
    ).toBe(false);
    expect(
      connectorSupportsTemporaryTestRecord({
        connection: browserConnection,
        adapter,
        contactCreateLiveProven: true,
      })
    ).toBe(true);
    const context = await resolveSafeTestContext({
      record: { mode: "temporary", reference: "" },
      operationKeys: ["note.create"],
      connection: browserConnection,
      adapter,
      secret: {},
      contactCreateLiveProven: true,
      correlationId: "temporary-context-77",
    });
    expect(context).toMatchObject({
      contactExternalId: "temporary-contact-77",
      temporaryRecordCreated: true,
      temporaryRecordCleanup: "manager_remove",
    });
    expect(adapter.createContact).toHaveBeenCalledOnce();
  });

  it("does not restore a repaired write without controlled proof and readback", () => {
    expect(
      automaticRepairStatusAfterProof({
        mode: "write",
        safeVerificationPassed: true,
      })
    ).toBe("TEST_READY");
    expect(
      automaticRepairStatusAfterProof({
        mode: "write",
        safeVerificationPassed: true,
        controlledWriteProof: true,
        readbackVerified: true,
      })
    ).toBe("LIVE_PROVEN");
  });

  it("keeps an optional failure from blocking the proven core selling loop", () => {
    const statuses = new Map([
      ["contact.search", "LIVE_PROVEN"],
      ["contact.read", "LIVE_PROVEN"],
      ["task.list", "LIVE_PROVEN"],
      ["note.create", "LIVE_PROVEN"],
      ["task.create_callback", "LIVE_PROVEN"],
      ["opportunity.read", "LIVE_PROVEN"],
      ["opportunity.update", "LIVE_PROVEN"],
      ["whatsapp.send", "DEGRADED"],
    ]);
    expect(coreBrowserCommissioningReady(statuses)).toBe(true);
  });

  it("keeps known-preset bootstrap and proven-operation commissioning separate", () => {
    const service = readFileSync(
      new URL("./automaticCommissioning.ts", import.meta.url),
      "utf8"
    );
    const onboarding = readFileSync(
      new URL("../../client/src/pages/Onboarding.tsx", import.meta.url),
      "utf8"
    );
    expect(service).toContain("installKnownGeniePack");
    expect(service).toContain("operationDefinitions");
    expect(service).toContain("knownGeniePack");
    expect(service).toContain("runGenxAgent");
    expect(service).toContain("semanticDiscoveryCalls");
    expect(onboarding).not.toContain("Teach Amarktai");
    expect(onboarding).not.toContain("BrowserOperationMatrix");
    expect(onboarding).not.toContain("sessionStorage.setItem");
    expect(onboarding).toContain("Open CRM to continue");
    expect(onboarding).toContain("Secure CRM Browser");
  });

  it("retains the simple native OAuth adapter flow", () => {
    const oauth = readFileSync(
      new URL("./oauthRoutes.ts", import.meta.url),
      "utf8"
    );
    expect(oauth).toContain("exchangeAuthorizationCode");
    expect(oauth).toContain("adapter.testConnection");
    expect(oauth).toContain("recordConnectionVerification");
  });

  it("keeps automatic navigation authorised and write publication readback-gated", () => {
    const adapter = readFileSync(
      new URL("../browserConnectors/browserCrmAdapter.ts", import.meta.url),
      "utf8"
    );
    expect(adapter).toContain("inspectBrowserCrmNavigation");
    expect(adapter).toContain("assertAuthorisedConnectionUrl");
    expect(adapter).toContain("postconditionRead");
    expect(adapter).toContain("EXECUTION_UNVERIFIED");
    expect(adapter).toContain(
      'postconditionVerified: learned.definition.mode === "write"'
    );
  });

  it("continues any approved browser session at discovery instead of looping through login", () => {
    const service = readFileSync(
      new URL("./automaticCommissioning.ts", import.meta.url),
      "utf8"
    );
    expect(service).toContain(
      "isBrowserSessionPackage(approvedBrowserSecret.browserSession)"
    );
    expect(service).toContain('"DISCOVER_NAVIGATION" as const');
    expect(service).toContain('secureSession: "complete"');
  });
});

describe("deterministic CRM batch execution", () => {
  it("processes 1,000 records with one intent interpretation and no AI-per-record loop", async () => {
    const records = Array.from({ length: 1_000 }, (_, index) => ({
      id: `lead-${index + 1}`,
    }));
    let aiCalls = 0;
    let active = 0;
    let maximumActive = 0;
    const completed = new Set<string>();
    const progress = vi.fn();
    const result = await runDeterministicCrmBatch({
      jobId: "overdue-next-action",
      instruction: "Make sure all overdue leads have a next action",
      interpretInstruction: async instruction => {
        aiCalls += 1;
        return { instruction, overdueOnly: true };
      },
      fetchPage: async (_plan, cursor, pageSize) => {
        const start = cursor ? Number(cursor) : 0;
        const page = records.slice(start, start + pageSize);
        const next = start + page.length;
        return {
          records: page,
          nextCursor: next < records.length ? String(next) : undefined,
        };
      },
      recordId: record => record.id,
      execute: async (_record, _plan, key) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await Promise.resolve();
        active -= 1;
        completed.add(key);
      },
      verify: async () => true,
      alreadyCompleted: async key => completed.has(key),
      markCompleted: async key => void completed.add(key),
      onProgress: progress,
      pageSize: 125,
      concurrency: 8,
    });
    expect(aiCalls).toBe(1);
    expect(result.progress).toMatchObject({
      discovered: 1_000,
      completed: 1_000,
      failed: 0,
      cancelled: false,
    });
    expect(maximumActive).toBeLessThanOrEqual(8);
    expect(result.results).toHaveLength(1_000);
    expect(progress).toHaveBeenCalled();
  });
});
