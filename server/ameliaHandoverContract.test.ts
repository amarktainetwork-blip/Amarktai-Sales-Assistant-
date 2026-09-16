import { describe, it, expect } from "vitest";
import {
  AMELIA_HANDOVER as a,
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
  it("fails the handover when any required proof is absent", () => {
    expect(handoverAllPassed([])).toBe(false);
    expect(handoverAllPassed([{ ok: true }, { ok: false }])).toBe(false);
    expect(handoverAllPassed([{ ok: true }])).toBe(true);
  });
});
