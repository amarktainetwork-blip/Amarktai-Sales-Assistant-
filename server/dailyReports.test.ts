import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listEnabledDailyReports: vi.fn(),
  claimDailyReportDelivery: vi.fn(),
  markDailyReportDelivery: vi.fn(),
  releaseDailyReportDelivery: vi.fn(),
  getAssistantDashboard: vi.fn(),
  sendDailyWorkspaceReport: vi.fn(),
}));

vi.mock("./db", () => ({ listEnabledDailyReports: mocks.listEnabledDailyReports, claimDailyReportDelivery: mocks.claimDailyReportDelivery, markDailyReportDelivery: mocks.markDailyReportDelivery, releaseDailyReportDelivery: mocks.releaseDailyReportDelivery, getAssistantDashboard: mocks.getAssistantDashboard }));
vi.mock("./smtp", () => ({ sendDailyWorkspaceReport: mocks.sendDailyWorkspaceReport }));

import { isUtcCronDue, runDueDailyReports } from "./dailyReports";

const now = new Date("2026-08-22T09:30:00.000Z");
const dueReport = { id: 11, userId: 7, recipientEmail: "admin@example.co.za", cronExpression: "0 30 9 * * 6", isEnabled: true };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listEnabledDailyReports.mockResolvedValue([]);
  mocks.claimDailyReportDelivery.mockResolvedValue(true);
  mocks.getAssistantDashboard.mockResolvedValue({ metrics: { actionsAwaitingReview: 2, openCallbackTasks: 1, knowledgeSources: 4 } });
  mocks.sendDailyWorkspaceReport.mockResolvedValue(undefined);
  mocks.markDailyReportDelivery.mockResolvedValue(undefined);
  mocks.releaseDailyReportDelivery.mockResolvedValue(undefined);
});

describe("UTC scheduler expression matching", () => {
  it("matches due schedules and rejects disabled-by-time schedules", () => {
    expect(isUtcCronDue("0 30 9 * * 6", now)).toBe(true);
    expect(isUtcCronDue("0 31 9 * * 6", now)).toBe(false);
    expect(isUtcCronDue("invalid", now)).toBe(false);
  });
});

describe("self-hosted daily report worker", () => {
  it("sends only a due enabled report after atomically claiming its delivery key", async () => {
    mocks.listEnabledDailyReports.mockResolvedValue([dueReport, { ...dueReport, id: 12, cronExpression: "0 31 9 * * 6" }, { ...dueReport, id: 13, isEnabled: false }]);

    await expect(runDueDailyReports(now)).resolves.toEqual([{ reportId: 11, state: "sent" }]);
    expect(mocks.claimDailyReportDelivery).toHaveBeenCalledWith(11, "2026-08-22");
    expect(mocks.sendDailyWorkspaceReport).toHaveBeenCalledWith({ to: "admin@example.co.za", actionsAwaitingReview: 2, openCallbackTasks: 1, knowledgeSources: 4 });
    expect(mocks.markDailyReportDelivery).toHaveBeenCalledWith(11, "2026-08-22");
    expect(mocks.claimDailyReportDelivery).not.toHaveBeenCalledWith(12, expect.anything());
    expect(mocks.claimDailyReportDelivery).not.toHaveBeenCalledWith(13, expect.anything());
  });

  it("skips a due report that has already been atomically claimed", async () => {
    mocks.listEnabledDailyReports.mockResolvedValue([dueReport]);
    mocks.claimDailyReportDelivery.mockResolvedValue(false);

    await expect(runDueDailyReports(now)).resolves.toEqual([{ reportId: 11, state: "skipped" }]);
    expect(mocks.sendDailyWorkspaceReport).not.toHaveBeenCalled();
  });

  it("releases a failed claim so a later worker run can retry safely", async () => {
    mocks.listEnabledDailyReports.mockResolvedValue([dueReport]);
    mocks.sendDailyWorkspaceReport.mockRejectedValue(new Error("SMTP unavailable"));

    await expect(runDueDailyReports(now)).resolves.toEqual([{ reportId: 11, state: "failed" }]);
    expect(mocks.markDailyReportDelivery).not.toHaveBeenCalled();
    expect(mocks.releaseDailyReportDelivery).toHaveBeenCalledWith(11, "2026-08-22", "SMTP unavailable");
  });
});
