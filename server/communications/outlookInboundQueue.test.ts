import { afterEach, describe, expect, it, vi } from "vitest";
import { createOutlookInboundHandler } from "./outlookInboundRoutes";
import {
  OUTLOOK_INBOUND_MAX_ATTEMPTS,
  outlookRetryDecision,
  processOutlookQueuePayload,
} from "./outlookInboundQueue";

function responseRecorder() {
  const state: { status?: number; body?: unknown } = {};
  const response = {
    type: vi.fn().mockReturnThis(),
    status: vi.fn((status: number) => {
      state.status = status;
      return response;
    }),
    send: vi.fn((body: unknown) => {
      state.body = body;
      return response;
    }),
    json: vi.fn((body: unknown) => {
      state.body = body;
      return response;
    }),
  };
  return { response, state };
}

describe("durable Outlook inbound boundary", () => {
  afterEach(() => {
    delete process.env.OUTLOOK_WEBHOOK_CLIENT_STATE;
    delete process.env.OUTLOOK_INBOUND_ORGANISATION_ID;
  });

  it("durably queues and returns 202 without Graph message retrieval", async () => {
    process.env.OUTLOOK_WEBHOOK_CLIENT_STATE = "a-secure-client-state-value";
    process.env.OUTLOOK_INBOUND_ORGANISATION_ID = "17";
    const enqueue = vi.fn().mockResolvedValue({ accepted: 1 });
    const handler = createOutlookInboundHandler({ enqueue });
    const { response, state } = responseRecorder();
    await handler(
      {
        query: {},
        body: {
          value: [
            {
              clientState: process.env.OUTLOOK_WEBHOOK_CLIENT_STATE,
              subscriptionId: "subscription-1",
              resourceData: { id: "message-1" },
            },
          ],
        },
      } as never,
      response as never
    );
    expect(enqueue).toHaveBeenCalledWith([
      {
        organisationId: 17,
        messageId: "message-1",
        subscriptionId: "subscription-1",
      },
    ]);
    expect(state).toEqual({
      status: 202,
      body: { accepted: true, queued: 1, rejected: 0 },
    });
  });

  it("keeps duplicate processing idempotent through the existing inbound key", async () => {
    const readMessage = vi.fn().mockResolvedValue({
      externalMessageId: "graph-message-1",
      channel: "email",
      senderReference: "lead@example.test",
      body: "Hello",
      receivedAt: new Date(),
    });
    const seen = new Set<string>();
    const ingest = vi.fn(
      async ({ envelope }: { envelope: { externalMessageId: string } }) => {
        const duplicate = seen.has(envelope.externalMessageId);
        seen.add(envelope.externalMessageId);
        return { duplicate };
      }
    );
    const first = await processOutlookQueuePayload({
      organisationId: 1,
      messageId: "graph-message-1",
      readMessage,
      ingest: ingest as never,
    });
    const second = await processOutlookQueuePayload({
      organisationId: 1,
      messageId: "graph-message-1",
      readMessage,
      ingest: ingest as never,
    });
    expect(first).toEqual({ duplicate: false });
    expect(second).toEqual({ duplicate: true });
  });

  it("uses bounded exponential retry and then dead-letters", () => {
    expect(outlookRetryDecision(1).status).toBe("queued");
    expect(outlookRetryDecision(OUTLOOK_INBOUND_MAX_ATTEMPTS)).toMatchObject({
      status: "dead_letter",
    });
  });
});
