import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

describe("browser CRM identity isolation", () => {
  it("restores the interactive CRM browser only from the current user's session", () => {
    const manager = read("./browserConnectors/managedCrmBrowserSessionManager.ts");

    expect(manager).toContain("loadUserConnectionSecret");
    expect(manager).toContain("const restored = personalSession");
    expect(manager).not.toContain("const sharedSession");
    expect(manager).not.toContain("personalSession || sharedSession");
    expect(manager).toContain("user:${userId}");
  });

  it("binds the backend-only commissioning snapshot to one manager and never treats it as an interactive restore", () => {
    const manager = read("./browserConnectors/managedCrmBrowserSessionManager.ts");
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
    expect(sync).toContain("Your CRM needs you to sign in again before synchronisation can continue.");
  });

  it("uses the proposal owner's browser identity for reviewed CRM writes", () => {
    const execute = read("./crm/executeApprovedAction.ts");

    expect(execute).toContain("loadUserConnectionSecret");
    expect(execute).toContain("input.proposal.userId");
    expect(execute).toContain("Your CRM needs you to sign in again before this approved change can be applied.");
  });
});
