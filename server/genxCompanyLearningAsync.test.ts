import { afterEach, describe, expect, it, vi } from "vitest";
import { GenxCompanyLearningClient } from "./genxCompanyLearning";

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("GenX async company-learning jobs", () => {
  it("polls queued and processing jobs to completion and decodes the live data URL result", async () => {
    let polls = 0;
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (
          url.endsWith("/sessions/session-1/messages") &&
          init?.method === "POST"
        )
          return json(
            {
              session_id: "session-1",
              message_id: "message-1",
              job_id: "job-1",
              status: "queued",
            },
            202
          );
        if (url.endsWith("/jobs/job-1")) {
          polls += 1;
          if (polls === 1)
            return json({ job_id: "job-1", status: "processing" });
          return json({
            job_id: "job-1",
            status: "completed",
            result_url: "data:text/plain;base64,eyJwcm9iZSI6dHJ1ZX0=",
          });
        }
        return json({ error: "unexpected" }, 404);
      }
    );

    const client = new GenxCompanyLearningClient({
      apiKey: "gnxk_test",
      restBaseUrl: "https://query.test/api/v1",
      fetchImpl: fetchImpl as typeof fetch,
      pollIntervalMs: 100,
      recordCredits: vi.fn(),
    });

    await expect(
      client.sendSessionMessage({
        sessionId: "session-1",
        content: "analyse",
        fileIds: [],
        idempotencyKey: "async-success",
        billing: {
          userId: 1,
          organisationId: 1,
          feature: "company-learning",
          reference: "test",
        },
      })
    ).resolves.toMatchObject({ content: '{"probe":true}' });

    expect(polls).toBe(2);
  });

  it("fails closed when the asynchronous job reports a terminal failure", async () => {
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (
          url.endsWith("/sessions/session-1/messages") &&
          init?.method === "POST"
        )
          return json({ job_id: "job-failed", status: "queued" }, 202);
        if (url.endsWith("/jobs/job-failed"))
          return json({
            job_id: "job-failed",
            status: "failed",
            message: "upstream inference failed",
          });
        return json({ error: "unexpected" }, 404);
      }
    );

    const client = new GenxCompanyLearningClient({
      apiKey: "gnxk_test",
      restBaseUrl: "https://query.test/api/v1",
      fetchImpl: fetchImpl as typeof fetch,
      pollIntervalMs: 100,
      recordCredits: vi.fn(),
    });

    await expect(
      client.sendSessionMessage({
        sessionId: "session-1",
        content: "analyse",
        fileIds: [],
        idempotencyKey: "async-failure",
        billing: {
          userId: 1,
          organisationId: 1,
          feature: "company-learning",
          reference: "test",
        },
      })
    ).rejects.toThrow("Company-learning job failed: upstream inference failed");
  });

  it("bounds polling and times out instead of waiting forever", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (
          url.endsWith("/sessions/session-1/messages") &&
          init?.method === "POST"
        )
          return json({ job_id: "job-stuck", status: "queued" }, 202);
        if (url.endsWith("/jobs/job-stuck"))
          return json({ job_id: "job-stuck", status: "processing" });
        return json({ error: "unexpected" }, 404);
      }
    );

    const client = new GenxCompanyLearningClient({
      apiKey: "gnxk_test",
      restBaseUrl: "https://query.test/api/v1",
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 10_000,
      pollIntervalMs: 100,
      recordCredits: vi.fn(),
    });

    const request = client.sendSessionMessage({
      sessionId: "session-1",
      content: "analyse",
      fileIds: [],
      idempotencyKey: "async-timeout",
      billing: {
        userId: 1,
        organisationId: 1,
        feature: "company-learning",
        reference: "test",
      },
    });
    const assertion = expect(request).rejects.toThrow(
      "Company-learning job timed out before completion."
    );

    await vi.advanceTimersByTimeAsync(10_100);
    await assertion;
  });
});
