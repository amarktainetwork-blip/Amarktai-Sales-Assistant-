import { describe, expect, it } from "vitest";
import {
  accountBrowserCapabilities,
  REQUIRED_COMMISSIONED_OPERATIONS,
} from "./capabilityAccounting";

describe("complete CRM capability gap accounting", () => {
  it("accounts for every catalogue item and names every missing critical operation", () => {
    const statuses = new Map<string, string>();
    for (const key of REQUIRED_COMMISSIONED_OPERATIONS)
      statuses.set(key, "LIVE_PROVEN");
    statuses.set("note.create", "DEGRADED");
    const result = accountBrowserCapabilities({
      operationStatuses: statuses,
      discoveredOperationKeys: ["custom.read.student-enrolment"],
      allowedReadCapabilities: [
        "contacts.read",
        "companies.read",
        "tasks.read",
        "activities.read",
        "opportunities.read",
        "owners.read",
        "pipelines.read",
      ],
      allowedWriteCapabilities: [
        "notes.write",
        "tasks.write",
        "opportunities.write",
      ],
    });
    expect(result.rows.length).toBeGreaterThan(30);
    expect(new Set(result.rows.map(row => row.operationKey)).size).toBe(
      result.rows.length
    );
    expect(result.criticalGaps).toContainEqual({
      operationKey: "note.create",
      status: "NEEDS_REPAIR",
    });
    expect(result.criticalGaps).toContainEqual({
      operationKey: "custom.read.student-enrolment",
      status: "DISCOVERED",
    });
    expect(result.complete).toBe(false);
  });

  it("reports complete only when every critical operation is LIVE_PROVEN and authorised", () => {
    const statuses = new Map(
      REQUIRED_COMMISSIONED_OPERATIONS.map(key => [key, "LIVE_PROVEN"])
    );
    const result = accountBrowserCapabilities({
      operationStatuses: statuses,
      discoveredOperationKeys: [],
      allowedReadCapabilities: [
        "contacts.read",
        "companies.read",
        "tasks.read",
        "activities.read",
        "opportunities.read",
        "owners.read",
        "pipelines.read",
      ],
      allowedWriteCapabilities: [
        "notes.write",
        "tasks.write",
        "opportunities.write",
      ],
    });
    expect(result.criticalGaps).toEqual([]);
    expect(result.complete).toBe(true);
  });
});
