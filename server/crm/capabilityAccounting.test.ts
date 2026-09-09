import { describe, expect, it } from "vitest";
import {
  accountBrowserCapabilities,
  REQUIRED_COMMISSIONED_OPERATIONS,
} from "./capabilityAccounting";
import { CORE_BROWSER_OPERATIONS } from "./commissioningReadiness";

describe("complete CRM capability gap accounting", () => {
  it("keeps authorised discovered reads as gaps but never makes writes an onboarding gate", () => {
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
    expect(result.criticalGaps).not.toContainEqual({
      operationKey: "note.create",
      status: "NEEDS_REPAIR",
    });
    expect(result.criticalGaps).toContainEqual({
      operationKey: "custom.read.student-enrolment",
      status: "DISCOVERED",
    });
    expect(result.complete).toBe(false);
  });

  it("does not make NOT_AUTHORISED or optional unsupported surfaces critical", () => {
    const statuses = new Map<string, string>(
      CORE_BROWSER_OPERATIONS.map(key => [key, "LIVE_PROVEN"])
    );
    const result = accountBrowserCapabilities({
      operationStatuses: statuses,
      discoveredOperationKeys: [],
      allowedReadCapabilities: ["contacts.read"],
      allowedWriteCapabilities: [],
    });
    const noteCreate = result.rows.find(row => row.operationKey === "note.create");
    const companyRead = result.rows.find(
      row => row.operationKey === "company.read"
    );
    expect(noteCreate?.status).toBe("NOT_AUTHORISED");
    expect(companyRead?.status).toBe("NOT_AUTHORISED");
    expect(result.criticalGaps).toEqual([]);
    expect(result.complete).toBe(true);
  });

  it("reports complete when every available authorised read that can gate setup is proven", () => {
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
      allowedWriteCapabilities: [],
    });
    expect(result.criticalGaps).toEqual([]);
    expect(result.complete).toBe(true);
  });
});
