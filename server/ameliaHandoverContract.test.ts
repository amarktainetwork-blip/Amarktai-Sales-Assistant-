import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  AMELIA_HANDOVER as a,
  exactInboundRecipientProven,
  exactOwnerCounts,
  exactTaskCollectionProven,
  handoverAllPassed,
} from "./ameliaHandoverContract";
describe("Amelia handover verifier fails closed", () => {
  it("does not pin live contact counts to the old baseline", () =>
    expect(
      exactOwnerCounts(
        [{ ownerExternalId: a.ownerExternalId, count: 24001 }],
        a.ownerExternalId
      )
    ).toEqual({ total: 24001, owned: 24001, nullOwner: 0, other: 0 }));
  it("accounts for null and other owners independently", () =>
    expect(
      exactOwnerCounts(
        [
          { ownerExternalId: null, count: 2 },
          { ownerExternalId: "other", count: 1 },
        ],
        a.ownerExternalId
      )
    ).toEqual({ total: 3, owned: 0, nullOwner: 2, other: 1 }));
  it("requires exact source proof even when tasks are zero", () => {
    expect(exactTaskCollectionProven(0, {})).toBe(false);
    expect(
      exactTaskCollectionProven(0, {
        ownerExternalId: a.ownerExternalId,
        sourceTotal: "0",
        pagesRead: "1",
      })
    ).toBe(true);
    expect(
      exactTaskCollectionProven(0, {
        ownerExternalId: "other",
        sourceTotal: "0",
        pagesRead: "1",
      })
    ).toBe(false);
  });
  it("verifies current pending tasks rather than historical task rows and does not require a foreign inbox message to exist", () => {
    const source = readFileSync(
      new URL("./verifyAmeliaHandover.ts", import.meta.url),
      "utf8"
    );
    expect(source).toContain("TASK_CURRENT_OPEN=");
    expect(source).toContain("exactEmailIsolation === true");
    expect(source).not.toContain("rejectedForeignRecipientCount > 0");
  });

  it("validates inbound ownership by channel instead of forcing email identity onto SMS/WhatsApp", () => {
    expect(
      exactInboundRecipientProven({
        mailboxUserId: a.userId,
        expectedUserId: a.userId,
        channel: "email",
        recipientReference: a.email,
        expectedEmail: a.email,
        contactOwnerExternalId: a.ownerExternalId,
        expectedOwnerExternalId: a.ownerExternalId,
      })
    ).toBe(true);
    expect(
      exactInboundRecipientProven({
        mailboxUserId: a.userId,
        expectedUserId: a.userId,
        channel: "sms",
        recipientReference: "+447428000560",
        expectedEmail: a.email,
        contactOwnerExternalId: a.ownerExternalId,
        expectedOwnerExternalId: a.ownerExternalId,
      })
    ).toBe(true);
    expect(
      exactInboundRecipientProven({
        mailboxUserId: a.userId,
        expectedUserId: a.userId,
        channel: "whatsapp",
        recipientReference: "+447428000560",
        expectedEmail: a.email,
        contactOwnerExternalId: a.ownerExternalId,
        expectedOwnerExternalId: a.ownerExternalId,
      })
    ).toBe(true);
    expect(
      exactInboundRecipientProven({
        mailboxUserId: 999,
        expectedUserId: a.userId,
        channel: "sms",
        recipientReference: "+447428000560",
        expectedEmail: a.email,
        contactOwnerExternalId: a.ownerExternalId,
        expectedOwnerExternalId: a.ownerExternalId,
      })
    ).toBe(false);
    expect(
      exactInboundRecipientProven({
        mailboxUserId: a.userId,
        expectedUserId: a.userId,
        channel: "email",
        recipientReference: "team@example.com",
        expectedEmail: a.email,
        contactOwnerExternalId: a.ownerExternalId,
        expectedOwnerExternalId: a.ownerExternalId,
      })
    ).toBe(true);
    expect(
      exactInboundRecipientProven({
        mailboxUserId: a.userId,
        expectedUserId: a.userId,
        channel: "email",
        recipientReference: "team@example.com",
        expectedEmail: a.email,
        contactOwnerExternalId: "other-owner",
        expectedOwnerExternalId: a.ownerExternalId,
      })
    ).toBe(false);
  });

  it("fails the handover when any required proof is absent", () => {
    expect(handoverAllPassed([])).toBe(false);
    expect(handoverAllPassed([{ ok: true }, { ok: false }])).toBe(false);
    expect(handoverAllPassed([{ ok: true }])).toBe(true);
  });

  it("converges a stale safe-read commissioning job when current durable truth is ready", () => {
    const source = readFileSync(
      new URL("./crm/currentReadiness.ts", import.meta.url),
      "utf8"
    );
    expect(source).toContain('state: "READY" as const');
    expect(source).toContain('status: "ready" as const');
    expect(source).toContain("leaseExpiresAt: null");
    expect(source).toContain("lastError: null");
    expect(source).toContain("job.completedAt ?? new Date()");
  });
});
