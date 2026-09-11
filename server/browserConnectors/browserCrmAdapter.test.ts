import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeBrowserActivityRow,
  normalizeBrowserContactRow,
  normalizeBrowserOpportunityRow,
  normalizeBrowserTaskRow,
  resolveBrowserProfile,
} from "./browserCrmAdapter";

describe("provider-neutral browser CRM row normalization", () => {
  it("normalizes contacts and retains external identity", () => {
    expect(
      normalizeBrowserContactRow({
        id: "c-1",
        email: "Lead@Example.com",
        phone: "+27 82 000 0000",
        status: "Prospect",
      })
    ).toMatchObject({
      externalId: "c-1",
      email: "lead@example.com",
      lifecycleStage: "Prospect",
    });
  });

  it("canonicalizes provider record URLs to immutable source IDs", () => {
    expect(
      normalizeBrowserContactRow({
        externalId:
          "https://example.genie.test/v2/location/location-1/contacts/detail/contact-123",
        name: "Example Lead",
      }).externalId
    ).toBe("contact-123");
    expect(
      normalizeBrowserTaskRow({
        externalId:
          "https://example.genie.test/v2/location/location-1/tasks?recordId=task-456",
        contactExternalId:
          "https://example.genie.test/v2/location/location-1/contacts/detail/contact-123",
        title: "Follow up",
      })
    ).toMatchObject({
      externalId: "task-456",
      contactExternalId: "contact-123",
    });
  });

  it("normalizes tasks, opportunities and activities", () => {
    expect(
      normalizeBrowserTaskRow({
        externalId: "t-1",
        title: "Callback",
        status: "open",
        dueAt: "2026-08-24T08:00:00Z",
      }).dueAt?.toISOString()
    ).toBe("2026-08-24T08:00:00.000Z");
    expect(
      normalizeBrowserOpportunityRow({
        id: "o-1",
        name: "Renewal",
        value: "125.50",
        stage: "Proposal",
      })
    ).toMatchObject({
      externalId: "o-1",
      valueMinor: 12550,
      stage: "Proposal",
    });
    expect(
      normalizeBrowserActivityRow({
        id: "a-1",
        type: "email",
        occurredAt: "2026-08-23T08:00:00Z",
      })
    ).toMatchObject({ externalId: "a-1", activityType: "email" });
  });

  it("fails closed without an external record identity", () => {
    expect(() =>
      normalizeBrowserContactRow({ email: "missing@example.com" })
    ).toThrow("INVALID_EXTERNAL_ID");
    expect(() => normalizeBrowserTaskRow({ title: "No ID" })).toThrow(
      "INVALID_EXTERNAL_ID"
    );
  });
});

describe("browser profile", () => {
  it("keeps repeated browser CRM reads, sync and writes behind the hard zero-model boundary", async () => {
    const source = await readFile(
      new URL("./browserCrmAdapter.ts", import.meta.url),
      "utf8"
    );
    expect(source).toContain("runModelFreeOperation(");
    expect(source).toContain('purpose: "crm_operation"');
    expect(source).not.toContain("runGenxAgent");
  });

  it("uses connectedSystem.baseUrl as a provider hint without credentials", async () => {
    const profile = await resolveBrowserProfile(
      {
        id: 8,
        organisationId: 7,
        provider: "genie",
        displayName: "Genie",
        baseUrl: "https://genie.customer.example/",
        connectionMethod: "browser",
        allowedReadCapabilities: [],
        allowedWriteCapabilities: [],
        verifiedCapabilities: [],
        scopes: [],
        configuration: {},
      },
      "genie"
    );
    expect(profile?.login).toEqual({ url: "https://genie.customer.example/" });
    expect(JSON.stringify(profile)).not.toMatch(/credential|passcode|secret/i);
  });

  it("uses the current canonical definition instead of a stale installed known-Genie definition", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amarktai-genie-profile-"));
    const path = join(directory, "genie-scripts.json");
    const previous = process.env.GENIE_SCRIPTS_CONFIG_PATH;
    await writeFile(
      path,
      JSON.stringify({
        scripts: {},
        operationDefinitions: {
          "contact.search": {
            definition: {
              mode: "read",
              execute: {
                steps: [
                  { action: "read_text", selector: "body", key: "legacyBody" },
                ],
              },
            },
            prerequisites: { knownGeniePack: true },
          },
          "custom.read.customer_view": {
            definition: {
              mode: "read",
              execute: {
                steps: [
                  {
                    action: "read_rows",
                    selector: "[data-row]",
                    key: "records",
                    fields: { externalId: { attribute: "data-id" } },
                  },
                ],
              },
              resultKey: "records",
            },
          },
        },
      })
    );
    process.env.GENIE_SCRIPTS_CONFIG_PATH = path;
    try {
      const profile = await resolveBrowserProfile(
        {
          id: 10,
          organisationId: 7,
          provider: "genie",
          displayName: "Genie",
          baseUrl: "https://genie.customer.example/",
          connectionMethod: "browser",
          allowedReadCapabilities: [],
          allowedWriteCapabilities: [],
          verifiedCapabilities: [],
          scopes: [],
          configuration: {},
        },
        "genie"
      );
      expect(profile?.operationDefinitions?.["contact.search"]).toMatchObject({
        definition: {
          executeScript: "genie_contact_search",
          resultKey: "records",
        },
        prerequisites: {
          providerPack: "genie",
          providerPackVersion: expect.stringMatching(/^genie-/),
        },
      });
      expect(
        profile?.operationDefinitions?.["custom.read.customer_view"]
      ).toBeDefined();
    } finally {
      if (previous === undefined) delete process.env.GENIE_SCRIPTS_CONFIG_PATH;
      else process.env.GENIE_SCRIPTS_CONFIG_PATH = previous;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("retains installed operation definitions for a fresh Genie baseUrl profile", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amarktai-genie-profile-"));
    const path = join(directory, "genie-scripts.json");
    const previous = process.env.GENIE_SCRIPTS_CONFIG_PATH;
    await writeFile(
      path,
      JSON.stringify({
        scripts: {},
        operationDefinitions: {
          "contact.search": {
            definition: { operationKey: "contact.search", mode: "read" },
          },
        },
      })
    );
    process.env.GENIE_SCRIPTS_CONFIG_PATH = path;
    try {
      const profile = await resolveBrowserProfile(
        {
          id: 9,
          organisationId: 7,
          provider: "genie",
          displayName: "Genie",
          baseUrl: "https://genie.customer.example/",
          connectionMethod: "browser",
          allowedReadCapabilities: [],
          allowedWriteCapabilities: [],
          verifiedCapabilities: [],
          scopes: [],
          configuration: {},
        },
        "genie"
      );
      expect(profile?.operationDefinitions?.["contact.search"]).toMatchObject({
        definition: { operationKey: "contact.search", mode: "read" },
      });
    } finally {
      if (previous === undefined) delete process.env.GENIE_SCRIPTS_CONFIG_PATH;
      else process.env.GENIE_SCRIPTS_CONFIG_PATH = previous;
      await rm(directory, { recursive: true, force: true });
    }
  });
});
