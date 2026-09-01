import { describe, expect, it } from "vitest";
import {
  companyKnowledgeAutoRefreshIntervalMs,
  shouldQueueCompanyKnowledgeRefresh,
} from "./companyKnowledgeRefresh";

describe("automatic company knowledge refresh", () => {
  it("defaults to a daily refresh cadence", () => {
    const previous = process.env.COMPANY_KNOWLEDGE_AUTO_REFRESH_HOURS;
    delete process.env.COMPANY_KNOWLEDGE_AUTO_REFRESH_HOURS;
    try {
      expect(companyKnowledgeAutoRefreshIntervalMs()).toBe(24 * 60 * 60_000);
    } finally {
      if (previous === undefined)
        delete process.env.COMPANY_KNOWLEDGE_AUTO_REFRESH_HOURS;
      else process.env.COMPANY_KNOWLEDGE_AUTO_REFRESH_HOURS = previous;
    }
  });

  it("does not stack refreshes while work or manager review is pending", () => {
    const base = {
      now: new Date("2026-09-01T12:00:00Z"),
      intervalMs: 24 * 60 * 60_000,
      latestJobCreatedAt: new Date("2026-08-30T12:00:00Z"),
    };
    expect(
      shouldQueueCompanyKnowledgeRefresh({
        ...base,
        pendingReview: true,
        activeJob: false,
      })
    ).toBe(false);
    expect(
      shouldQueueCompanyKnowledgeRefresh({
        ...base,
        pendingReview: false,
        activeJob: true,
      })
    ).toBe(false);
  });

  it("queues only when the previous learning run is old enough", () => {
    const now = new Date("2026-09-01T12:00:00Z");
    const intervalMs = 24 * 60 * 60_000;
    expect(
      shouldQueueCompanyKnowledgeRefresh({
        now,
        intervalMs,
        latestJobCreatedAt: new Date("2026-08-31T18:00:00Z"),
        pendingReview: false,
        activeJob: false,
      })
    ).toBe(false);
    expect(
      shouldQueueCompanyKnowledgeRefresh({
        now,
        intervalMs,
        latestJobCreatedAt: new Date("2026-08-30T12:00:00Z"),
        pendingReview: false,
        activeJob: false,
      })
    ).toBe(true);
  });
});
