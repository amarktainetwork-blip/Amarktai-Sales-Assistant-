import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  automaticRepairStatusAfterProof,
  buildSecretFreeDiscoveryPrompt,
  controlledWritePayload,
  coreBrowserCommissioningReady,
  inferBrowserOperationCandidates,
  nextCommissioningState,
} from "./automaticCommissioning";
import { runDeterministicCrmBatch } from "./deterministicBatch";

const snapshot = {
  pageUrl: "https://crm.example.test/app",
  readOnly: true as const,
  controls: [
    { tag: "a", role: "link", label: "Customers", selector: "#customers", href: "https://crm.example.test/customers" },
    { tag: "a", role: "link", label: "Tasks and callbacks", selector: "#tasks", href: "https://crm.example.test/tasks" },
    { tag: "a", role: "link", label: "Deals and pipeline", selector: "#deals", href: "https://crm.example.test/deals" },
    { tag: "button", role: "button", label: "Send WhatsApp", selector: '[data-testid="whatsapp"]' },
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
        mode: "existing",
        reference: "",
      })
    ).toThrow("AUTHORISED_TEST_RECORD_REQUIRED");
    expect(() =>
      controlledWritePayload("whatsapp.send", {
        mode: "existing",
        reference: "test-contact-1",
      })
    ).toThrow("AUTHORISED_TEST_DESTINATION_REQUIRED");
    expect(
      controlledWritePayload("note.create", {
        mode: "existing",
        reference: "test-contact-1",
      })
    ).toMatchObject({
      contactExternalId: "test-contact-1",
      controlledCommissioning: true,
    });
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

  it("keeps Genie zero-training and Advanced CRM Setup fallback separate", () => {
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
    expect(onboarding).toContain("commissioning/safe-test");
    expect(onboarding).toContain("commissioning?.advancedFallback");
    expect(onboarding).toContain("Advanced CRM Setup");
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
    expect(adapter).toContain("postconditionVerified: learned.definition.mode === \"write\"");
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
        return { records: page, nextCursor: next < records.length ? String(next) : undefined };
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
