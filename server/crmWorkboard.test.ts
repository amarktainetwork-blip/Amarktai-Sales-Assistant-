import { describe, expect, it } from "vitest";
import { isFreshCrmContext } from "./crmWorkboard";

describe("CRM Workboard context reuse", () => {
  it("reuses fresh snapshots and refreshes expired snapshots", () => {
    const now = new Date("2026-08-18T12:00:00.000Z");
    expect(isFreshCrmContext({ expiresAt: new Date("2026-08-18T12:20:00.000Z") }, now)).toBe(true);
    expect(isFreshCrmContext({ expiresAt: new Date("2026-08-18T11:59:00.000Z") }, now)).toBe(false);
  });
});
