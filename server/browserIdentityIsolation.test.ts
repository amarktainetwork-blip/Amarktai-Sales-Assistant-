import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

describe("browser CRM identity isolation", () => {
  it("restores the interactive CRM browser only from the current user's session", () => {
    const manager = read(
      "./browserConnectors/managedCrmBrowserSessionManager.ts"
    );

    expect(manager).toContain("loadUserConnectionSecret");
    expect(manager).toContain("const restored = personalSession");
    expect(manager).not.toContain("const sharedSession");
    expect(manager).not.toContain("personalSession || sharedSession");
    expect(manager).toContain("user:${userId}");
  });

  it("binds the backend-only commissioning snapshot to one manager and never treats it as an interactive restore", () => {
    const manager = read(
      "./browserConnectors/managedCrmBrowserSessionManager.ts"
    );
    const types = read("./crm/types.ts");

    expect(types).toContain("commissioningUserId?: number");
    expect(manager).toContain("existingShared.commissioningUserId");
    expect(manager).toContain("existingOwner !== session.openedByUserId");
    expect(manager).toContain("commissioningUserId: session.openedByUserId");
    expect(manager).toContain("ownsSharedCommissioningSession");
  });

  it("uses user-scoped browser authentication for CRM sync", () => {
    const sync = read("./crm/sync.ts");

    expect(sync).toContain("loadUserConnectionSecret");
    expect(sync).toContain("userId: input.userId");
    expect(sync).toContain(
      "Your CRM needs you to sign in again before synchronisation can continue."
    );
  });

  it("uses the proposal owner's browser identity for reviewed CRM writes", () => {
    const compatibility = read("./crm/executeApprovedAction.ts");
    const execute = read("./crm/canonicalActionExecution.ts");

    expect(compatibility).toContain("executeCanonicalApprovedAction");
    expect(execute).toContain("loadUserConnectionSecret");
    expect(execute).toContain("userId: input.proposal.userId");
    expect(execute).toContain(
      "Your private CRM session expired before execution. Sign in again; nothing was changed."
    );
  });

  it("has no generic organisation-level browser-session fallback", () => {
    const adapter = read("./browserConnectors/browserCrmAdapter.ts");
    const commissioning = read("./crm/automaticCommissioning.ts");
    const admin = read("./connectedSystemAdminRoutes.ts");

    expect(adapter).not.toContain("loadConnectionSecret");
    expect(adapter).toContain(
      "A user-owned or commissioning-owner CRM browser session is required."
    );
    expect(commissioning).toContain("ownedCommissioningSecret");
    expect(commissioning).toContain("commissioningUserId");
    expect(admin).toContain("secret?.commissioningUserId");
  });
});
