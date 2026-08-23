import { describe, expect, it, vi } from "vitest";
import {
  runCanonicalCallCloseout,
  type CloseoutStore,
} from "./closeoutIdempotency";

function memoryStore() {
  let nextId = 1;
  const workflows = new Map<
    string,
    {
      id: number;
      status: "prepared" | "completed" | "failed";
      token?: string;
      input: Record<string, unknown>;
      result?: Record<string, unknown>;
    }
  >();
  const byId = (id: number) =>
    [...workflows.values()].find(item => item.id === id)!;
  const store: CloseoutStore = {
    claim: vi.fn(async input => {
      const key = `${input.organisationId}:${input.userId}:${input.callSessionId}`;
      const existing = workflows.get(key);
      if (existing?.status === "completed")
        return {
          state: "completed" as const,
          workflowRunId: existing.id,
          result: existing.result!,
        };
      if (existing?.status === "prepared")
        return { state: "processing" as const, workflowRunId: existing.id };
      const workflow = existing || {
        id: nextId++,
        status: "failed" as const,
        input: {},
      };
      const token = `claim-${workflow.id}-${Date.now()}`;
      Object.assign(workflow, { status: "prepared", token });
      workflows.set(key, workflow);
      return {
        state: "claimed" as const,
        workflowRunId: workflow.id,
        claimToken: token,
        input: workflow.input,
      };
    }),
    read: vi.fn(async workflowRunId => {
      const workflow = byId(workflowRunId);
      return {
        id: workflow.id,
        status: workflow.status,
        result: workflow.result,
        input: workflow.input,
      } as Awaited<ReturnType<CloseoutStore["read"]>>;
    }),
    complete: vi.fn(async input =>
      Object.assign(byId(input.workflowRunId), {
        status: "completed",
        result: input.result,
        token: undefined,
      })
    ),
    fail: vi.fn(async input =>
      Object.assign(byId(input.workflowRunId), {
        status: "failed",
        input: { ...byId(input.workflowRunId).input, lastError: input.error },
        token: undefined,
      })
    ),
  };
  return { store, workflows };
}

const request = {
  userId: 7,
  organisationId: 3,
  callSessionId: 41,
  leadLabel: "John",
};

describe("durable canonical call closeout coordinator", () => {
  it("returns the same workflow on retry with no duplicate GenX, proposal, orphan workflow, or auto execution", async () => {
    const { store, workflows } = memoryStore();
    const counters = { genx: 0, proposals: 0, autoExecutions: 0 };
    const work = vi.fn(async claim => {
      counters.genx += 1;
      counters.proposals += 1;
      counters.autoExecutions += 1;
      return {
        closeoutWorkflowRunId: claim.workflowRunId,
        actions: [{ id: 1 }],
      };
    });
    const first = await runCanonicalCallCloseout(request, work, store);
    const retry = await runCanonicalCallCloseout(request, work, store);
    expect(retry).toEqual(first);
    expect(work).toHaveBeenCalledTimes(1);
    expect(counters).toEqual({ genx: 1, proposals: 1, autoExecutions: 1 });
    expect(workflows.size).toBe(1);
  });

  it("converges two concurrent identical requests on one canonical workflow", async () => {
    const { store, workflows } = memoryStore();
    const work = vi.fn(async claim => {
      await new Promise(resolve => setTimeout(resolve, 20));
      return { closeoutWorkflowRunId: claim.workflowRunId };
    });
    const [first, second] = await Promise.all([
      runCanonicalCallCloseout(request, work, store),
      runCanonicalCallCloseout(request, work, store),
    ]);
    expect(first).toEqual(second);
    expect(work).toHaveBeenCalledTimes(1);
    expect(workflows.size).toBe(1);
  });

  it("creates separate canonical workflows for different calls", async () => {
    const { store, workflows } = memoryStore();
    const work = async (claim: { workflowRunId: number }) => ({
      closeoutWorkflowRunId: claim.workflowRunId,
    });
    const first = await runCanonicalCallCloseout(request, work, store);
    const second = await runCanonicalCallCloseout(
      { ...request, callSessionId: 42 },
      work,
      store
    );
    expect(first.closeoutWorkflowRunId).not.toBe(second.closeoutWorkflowRunId);
    expect(workflows.size).toBe(2);
  });

  it("reuses the canonical workflow after a failed attempt and retries safely", async () => {
    const { store, workflows } = memoryStore();
    await expect(
      runCanonicalCallCloseout(
        request,
        async () => {
          throw new Error("temporary failure");
        },
        store
      )
    ).rejects.toThrow("temporary failure");
    const result = await runCanonicalCallCloseout(
      request,
      async claim => ({ closeoutWorkflowRunId: claim.workflowRunId }),
      store
    );
    expect(result.closeoutWorkflowRunId).toBe(1);
    expect(workflows.size).toBe(1);
  });

  it("reuses a durably saved summary after downstream failure without another GenX call", async () => {
    const { store } = memoryStore();
    let genxCalls = 0;
    await expect(
      runCanonicalCallCloseout(
        request,
        async claim => {
          if (!claim.input.summaryResult) {
            genxCalls += 1;
            claim.input.summaryResult = {
              content: "Canonical summary",
              genxCalls: 1,
            };
          }
          throw new Error("proposal preparation failed");
        },
        store
      )
    ).rejects.toThrow("proposal preparation failed");
    const retry = await runCanonicalCallCloseout(
      request,
      async claim => {
        if (!claim.input.summaryResult) genxCalls += 1;
        return {
          closeoutWorkflowRunId: claim.workflowRunId,
          summary: claim.input.summaryResult,
        };
      },
      store
    );
    expect(retry.summary).toEqual({
      content: "Canonical summary",
      genxCalls: 1,
    });
    expect(genxCalls).toBe(1);
  });
});
