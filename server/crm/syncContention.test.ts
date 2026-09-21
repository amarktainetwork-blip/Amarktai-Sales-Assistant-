import { describe, expect, it } from "vitest";
import {
  crmActivityHistoryProvesLeadWorked,
  crmTaskHistoryProvesLeadWorked,
  crmTaskProvesLeadProgress,
  isTransientCrmSyncFailure,
  routineOpportunitySnapshotDue,
} from "./sync";
it("does not hide permanent failures when another resource had transient contention", () => {
  const mixed = Object.assign(
    new Error(
      "CRM_SYNC_PARTIAL_FAILURE: tasks: CRM_VIEWER_AGENT_CONTROL_ACTIVE; contacts: TARGET_MISMATCH"
    ),
    { transient: false }
  );
  expect(isTransientCrmSyncFailure(mixed)).toBe(false);
  const retry = Object.assign(
    new Error(
      "CRM_SYNC_PARTIAL_FAILURE: tasks: CRM_VIEWER_AGENT_CONTROL_ACTIVE"
    ),
    { transient: true }
  );
  expect(isTransientCrmSyncFailure(retry)).toBe(true);
  expect(
    isTransientCrmSyncFailure(new Error("CRM_BROWSER_CONTROL_LEASE_LOST"))
  ).toBe(true);
});

describe("routine opportunity snapshot cadence", () => {
  const now = new Date("2026-09-18T19:30:00Z");

  it("does not let the expensive opportunity drain monopolize every realtime cycle", () => {
    expect(
      routineOpportunitySnapshotDue(
        new Date("2026-09-18T19:29:00Z"),
        now,
        15 * 60_000
      )
    ).toBe(false);
  });

  it("runs the full opportunity snapshot when it is stale or missing", () => {
    expect(routineOpportunitySnapshotDue(null, now, 15 * 60_000)).toBe(true);
    expect(
      routineOpportunitySnapshotDue(
        new Date("2026-09-18T19:15:00Z"),
        now,
        15 * 60_000
      )
    ).toBe(true);
  });
});

describe("CRM customer-history lead progression", () => {
  it("treats calls, salesperson-authored notes, inbound replies and verified salesperson outbound contact as proof the lead was worked", () => {
    const owner = "owner-1";
    expect(
      crmActivityHistoryProvesLeadWorked(
        { activityType: "call", ownerExternalId: owner, raw: {} },
        owner
      )
    ).toBe(true);
    expect(
      crmActivityHistoryProvesLeadWorked(
        {
          activityType: "note",
          ownerExternalId: owner,
          raw: { authorExternalId: owner },
        },
        owner
      )
    ).toBe(true);
    expect(
      crmActivityHistoryProvesLeadWorked(
        {
          activityType: "email",
          ownerExternalId: owner,
          raw: { direction: "inbound" },
        },
        owner
      )
    ).toBe(true);
    expect(
      crmActivityHistoryProvesLeadWorked(
        {
          activityType: "email",
          ownerExternalId: owner,
          raw: {
            direction: "outbound",
            senderReference: "Sales Person <sales@example.com>",
          },
        },
        owner,
        "sales@example.com"
      )
    ).toBe(true);
    expect(
      crmActivityHistoryProvesLeadWorked(
        {
          activityType: "sms",
          ownerExternalId: owner,
          raw: { direction: "outbound", userExternalId: owner },
        },
        owner
      )
    ).toBe(true);
  });

  it("does not treat automated-looking outbound messages or another author's note as salesperson work", () => {
    const owner = "owner-1";
    expect(
      crmActivityHistoryProvesLeadWorked(
        {
          activityType: "email",
          ownerExternalId: owner,
          raw: {
            direction: "outbound",
            senderReference: "Company <outreach@marketing.example.com>",
          },
        },
        owner,
        "sales@example.com"
      )
    ).toBe(false);
    expect(
      crmActivityHistoryProvesLeadWorked(
        {
          activityType: "note",
          ownerExternalId: owner,
          raw: { authorExternalId: "other-owner" },
        },
        owner
      )
    ).toBe(false);
  });
});

describe("CRM task lead progression", () => {
  it("keeps genuine first-contact tasks as new-lead work", () => {
    expect(crmTaskProvesLeadProgress({ title: "First Call" })).toBe(false);
    expect(crmTaskProvesLeadProgress({ title: "1st contact" })).toBe(false);
    expect(crmTaskProvesLeadProgress({ title: "Initial call" })).toBe(false);
  });

  it("uses completed first-contact history to retire stale new-lead alerts", () => {
    expect(
      crmTaskHistoryProvesLeadWorked({
        title: "First Call",
        status: "completed",
      })
    ).toBe(true);
    expect(
      crmTaskHistoryProvesLeadWorked({
        title: "First Call",
        status: "open",
      })
    ).toBe(false);
    expect(
      crmTaskHistoryProvesLeadWorked({
        title: "#2 IT yes",
        status: "open",
      })
    ).toBe(false);
  });

  it("classifies later-stage task titles as workflow progression context", () => {
    for (const title of [
      "#2 IT yes",
      "#3 cy no",
      "last try cy",
      "yes no Elcas",
      "Renewal Call",
      "Call back Friday",
    ])
      expect(crmTaskProvesLeadProgress({ title })).toBe(true);
  });
});
