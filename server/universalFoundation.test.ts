import { afterEach, describe, expect, it } from "vitest";
import { decryptConnectionSecret, encryptConnectionSecret, redactConnectionSecret } from "./security/connectionSecrets";
import { validateSavedBrowserScript } from "./browserConnectors/scriptEngine";
import { canManageOrganisation, canViewTeamData, hasOrganisationAccess } from "./organisationAccess";

describe("connection-secret encryption", () => {
  const previous = process.env.CONNECTION_SECRETS_MASTER_KEY;
  process.env.CONNECTION_SECRETS_MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
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
