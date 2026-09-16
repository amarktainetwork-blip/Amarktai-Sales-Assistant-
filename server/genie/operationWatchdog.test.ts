import { describe, expect, it } from "vitest";
import {
  selectLatestWatchdogVersions,
  watchdogIdentityMappingIsConfirmed,
  watchdogRepairPlan,
} from "./operationWatchdog";

describe("daily CRM drift economics", () => {
  it("uses zero GenX calls when every deterministic watchdog passes", () => {
    expect(
      watchdogRepairPlan([
        { operationKey: "contact.search", status: "live" },
        { operationKey: "contact.read", status: "live" },
      ])
    ).toEqual({
      affectedOperationKeys: [],
      unchangedGenxCalls: 0,
      maximumRepairBatches: 0,
    });
  });

  it("groups only affected operations into one targeted repair batch", () => {
    expect(
      watchdogRepairPlan([
        { operationKey: "contact.search", status: "live" },
        { operationKey: "task.read", status: "degraded" },
        { operationKey: "task.read", status: "degraded" },
        { operationKey: "opportunity.read", status: "degraded" },
      ])
    ).toEqual({
      affectedOperationKeys: ["task.read", "opportunity.read"],
      unchangedGenxCalls: undefined,
      maximumRepairBatches: 1,
    });
  });

  it("runs background drift checks only after one exact-email CRM identity mapping is confirmed", () => {
    expect(
      watchdogIdentityMappingIsConfirmed([
        {
          mappingEmail: " Amelia@Example.com ",
          userEmail: "amelia@example.com",
        },
      ])
    ).toBe(true);
    expect(watchdogIdentityMappingIsConfirmed([])).toBe(false);
    expect(
      watchdogIdentityMappingIsConfirmed([
        {
          mappingEmail: "wrong@example.com",
          userEmail: "amelia@example.com",
        },
      ])
    ).toBe(false);
    expect(
      watchdogIdentityMappingIsConfirmed([
        {
          mappingEmail: "amelia@example.com",
          userEmail: "amelia@example.com",
        },
        {
          mappingEmail: "amelia@example.com",
          userEmail: "amelia@example.com",
        },
      ])
    ).toBe(false);
  });

  it.each(["TEST_READY", "DEGRADED", "BLOCKED"])(
    "never executes v1 LIVE_PROVEN when latest v2 is %s",
    status => {
      const decisions = selectLatestWatchdogVersions(
        [
          { operationKey: "contact.read", version: 1, status: "LIVE_PROVEN" },
          { operationKey: "contact.read", version: 2, status },
        ],
        new Set(["contact.read"])
      );
      expect(decisions).toHaveLength(1);
      expect(decisions[0].operation.version).toBe(2);
      expect(decisions[0].eligible).toBe(false);
    }
  );
});
