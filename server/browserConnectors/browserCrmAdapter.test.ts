import { describe, expect, it } from "vitest";
import {
  normalizeBrowserActivityRow,
  normalizeBrowserContactRow,
  normalizeBrowserOpportunityRow,
  normalizeBrowserTaskRow,
  resolveBrowserCredentials,
  resolveBrowserProfile,
  meaningfulReadySelector,
} from "./browserCrmAdapter";

describe("Genie deterministic row normalization", () => {
  it("normalizes contacts and retains the provider external ID", () => {
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

  it("normalizes tasks and Manual Actions into the existing task model", () => {
    const result = normalizeBrowserTaskRow({
      externalId: "ma-1",
      title: "Pricing callback",
      status: "open",
      type: "manual_action",
      dueAt: "2026-08-24T08:00:00Z",
    });
    expect(result).toMatchObject({
      externalId: "ma-1",
      title: "Pricing callback",
      raw: { sourceKind: "manual_action" },
    });
    expect(result.dueAt?.toISOString()).toBe("2026-08-24T08:00:00.000Z");
  });

  it("normalizes opportunities and activity history", () => {
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
        body: "Requested pricing",
      })
    ).toMatchObject({
      externalId: "a-1",
      activityType: "email",
      body: "Requested pricing",
    });
  });

  it("fails safely when a structured row has no external ID", () => {
    expect(() =>
      normalizeBrowserContactRow({ email: "missing@example.com" })
    ).toThrow("INVALID_EXTERNAL_ID");
    expect(() => normalizeBrowserTaskRow({ title: "No ID" })).toThrow(
      "INVALID_EXTERNAL_ID"
    );
  });
});

describe("per-connection Genie commissioning defaults", () => {
  it("never accepts the document body as authentication proof", () => {
    expect(meaningfulReadySelector("body")).toBe(false);
    expect(meaningfulReadySelector("html")).toBe(false);
    expect(meaningfulReadySelector('[data-testid="dashboard"]')).toBe(true);
  });
  it("derives the primary login profile from connectedSystem.baseUrl without GENIE login credentials", async () => {
    const previous = {
      url: process.env.GENIE_LOGIN_URL,
      username: process.env.GENIE_USERNAME,
      password: process.env.GENIE_PASSWORD,
    };
    delete process.env.GENIE_LOGIN_URL;
    delete process.env.GENIE_USERNAME;
    delete process.env.GENIE_PASSWORD;
    try {
      const profile = await resolveBrowserProfile({
        id: 8,
        organisationId: 7,
        provider: "genie",
        displayName: "Genie",
        baseUrl: "https://genie.customer.example/sign-in",
        connectionMethod: "browser",
        allowedReadCapabilities: [],
        allowedWriteCapabilities: [],
        verifiedCapabilities: [],
        scopes: [],
        configuration: {},
      }, "genie");
      expect(profile?.login).toEqual({ url: "https://genie.customer.example/sign-in" });
      expect(resolveBrowserCredentials({ credentials: { username: "per-connection", password: "encrypted-secret" } }, "genie")).toEqual({ username: "per-connection", password: "encrypted-secret" });
      expect(JSON.stringify(profile)).not.toContain("encrypted-secret");
    } finally {
      if (previous.url === undefined) delete process.env.GENIE_LOGIN_URL; else process.env.GENIE_LOGIN_URL = previous.url;
      if (previous.username === undefined) delete process.env.GENIE_USERNAME; else process.env.GENIE_USERNAME = previous.username;
      if (previous.password === undefined) delete process.env.GENIE_PASSWORD; else process.env.GENIE_PASSWORD = previous.password;
    }
  });

  it("keeps install-level credentials as fallback while per-connection values take precedence", () => {
    const previous = process.env.GENIE_USERNAME;
    const previousPassword = process.env.GENIE_PASSWORD;
    process.env.GENIE_USERNAME = "legacy-user";
    process.env.GENIE_PASSWORD = "legacy-password";
    try {
      expect(resolveBrowserCredentials({ credentials: { username: "connection-user", password: "connection-password" } }, "genie")).toEqual({ username: "connection-user", password: "connection-password" });
    } finally {
      if (previous === undefined) delete process.env.GENIE_USERNAME; else process.env.GENIE_USERNAME = previous;
      if (previousPassword === undefined) delete process.env.GENIE_PASSWORD; else process.env.GENIE_PASSWORD = previousPassword;
    }
  });
});
