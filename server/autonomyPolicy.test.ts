import { describe, expect, it } from "vitest";
import {
  applyOrganisationAutonomyCeiling,
  autonomyDecision,
  normalizeAutonomySettings,
  reviewEverythingAutonomy,
} from "../shared/autonomyPolicy";

describe("autonomy and approval policy", () => {
  it("defaults every new user to review everything", () => {
    expect(normalizeAutonomySettings(undefined)).toEqual(
      reviewEverythingAutonomy()
    );
    expect(
      autonomyDecision({
        user: reviewEverythingAutonomy(),
        permission: "email_replies",
      }).reviewRequired
    ).toBe(true);
  });

  it("allows a user to change an individual custom permission", () => {
    const user = normalizeAutonomySettings({
      mode: "custom",
      permissions: { crm_notes: true },
    });
    expect(
      autonomyDecision({ user, permission: "crm_notes" }).reviewRequired
    ).toBe(false);
    expect(
      autonomyDecision({ user, permission: "new_emails" }).reviewRequired
    ).toBe(true);
  });

  it("keeps the organisation ceiling above user preference", () => {
    const full = normalizeAutonomySettings({ mode: "full" });
    const ceiling = normalizeAutonomySettings({
      mode: "custom",
      permissions: { crm_notes: true },
    });
    const effective = applyOrganisationAutonomyCeiling(full, ceiling);
    expect(effective.mode).toBe("custom");
    expect(effective.permissions.crm_notes).toBe(true);
    expect(effective.permissions.new_emails).toBe(false);
  });

  it("blocks opt-outs even in full autonomy", () => {
    expect(
      autonomyDecision({
        user: normalizeAutonomySettings({ mode: "full" }),
        permission: "new_emails",
        optedOut: true,
      })
    ).toMatchObject({ allowed: false, reason: "recipient_opted_out" });
  });

  it("does not let unverified external communication bypass review", () => {
    expect(
      autonomyDecision({
        user: normalizeAutonomySettings({ mode: "full" }),
        permission: "whatsapp",
        recipientVerified: false,
      })
    ).toMatchObject({ allowed: false, reviewRequired: true });
  });
});
