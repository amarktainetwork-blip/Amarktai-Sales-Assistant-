import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptConnectionSecret, encryptConnectionSecret, redactConnectionSecret } from "./security/connectionSecrets";
import { validateSavedBrowserScript } from "./browserConnectors/scriptEngine";
import { canManageOrganisation, canViewTeamData, hasOrganisationAccess } from "./organisationAccess";
import { connectionSecrets, websiteDiscoveries } from "../drizzle/schema";

describe("connection-secret encryption", () => {
  const previous = process.env.CONNECTION_SECRETS_MASTER_KEY;
  beforeEach(() => {
    process.env.CONNECTION_SECRETS_MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.CONNECTION_SECRETS_MASTER_KEY;
    else process.env.CONNECTION_SECRETS_MASTER_KEY = previous;
  });

  it("round-trips credentials without retaining plaintext in the envelope", () => {
    const encrypted = encryptConnectionSecret({ accessToken: "access-secret", refreshToken: "refresh-secret" });
    expect(JSON.stringify(encrypted)).not.toContain("access-secret");
    expect(decryptConnectionSecret<{ accessToken: string; refreshToken: string }>(encrypted)).toEqual({ accessToken: "access-secret", refreshToken: "refresh-secret" });
  });

  it("redacts credential-like fields before evidence is retained", () => {
    expect(redactConnectionSecret({ accessToken: "x", safe: "visible", password: "y" })).toEqual({ accessToken: "[REDACTED]", safe: "visible", password: "[REDACTED]" });
  });

  it("round-trips an encrypted browser replay package comfortably above 64 KB", () => {
    const largeSessionValue = "s".repeat(160_000);
    const encrypted = encryptConnectionSecret({ browserSession: {
      kind: "amarktai.browser-session", version: 2,
      storageState: { cookies: [], origins: [] },
      sessionStorageByOrigin: { "https://crm.example.test": { auth: largeSessionValue } },
      authorisedOrigins: ["https://crm.example.test"],
      capturedAt: "2026-08-25T10:00:00.000Z",
      authenticatedUrl: "https://crm.example.test/dashboard",
    } });
    expect(encrypted.ciphertext.length).toBeGreaterThan(65_535);
    expect(decryptConnectionSecret<{ browserSession: { sessionStorageByOrigin: Record<string, { auth: string }> } }>(encrypted).browserSession.sessionStorageByOrigin["https://crm.example.test"].auth).toHaveLength(160_000);
    expect(connectionSecrets.ciphertext.getSQLType()).toBe("longtext");
  });

  it("keeps website discovery payloads above 64 KB on LONGTEXT", () => {
    const extractedText = "Course2Career knowledge ".repeat(4_000);
    expect(Buffer.byteLength(extractedText, "utf8")).toBeGreaterThan(65_535);
    expect(websiteDiscoveries.extractedText.getSQLType()).toBe("longtext");
  });
});

describe("browser connector governance", () => {
  it("accepts a bounded declarative script", () => {
    expect(validateSavedBrowserScript({ steps: [{ action: "goto", value: "https://crm.example.test/contact/{{contactId}}" }, { action: "expect_visible", selector: "[data-record]" }] }).steps).toHaveLength(2);
  });

  it("rejects executable selector content", () => {
    expect(() => validateSavedBrowserScript({ steps: [{ action: "click", selector: "javascript:alert(1)" }] })).toThrow(/declarative/i);
  });
});

describe("organisation access policy", () => {
  const owner = { organisationId: 11, userId: 21, role: "owner" as const, isActive: true };

  it("does not permit a member of one organisation to access another", () => {
    expect(hasOrganisationAccess(owner, 12, 21)).toBe(false);
    expect(hasOrganisationAccess(owner, 11, 22)).toBe(false);
    expect(hasOrganisationAccess(owner, 11, 21)).toBe(true);
  });

  it("keeps management and team reporting role-specific", () => {
    expect(canManageOrganisation("owner")).toBe(true);
    expect(canManageOrganisation("manager")).toBe(true);
    expect(canManageOrganisation("salesperson")).toBe(false);
    expect(canViewTeamData("auditor")).toBe(true);
    expect(canViewTeamData("salesperson")).toBe(false);
  });
});
