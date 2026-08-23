import { describe, expect, it } from "vitest";
import { coalesceTenantAiRequest, tenantAiRequestKey } from "./aiCoalescing";

describe("tenant-safe GenX request coalescing", () => {
  it("coalesces identical simultaneous eligible work", async () => {
    let calls = 0;
    const key = tenantAiRequestKey({
      organisationId: 1,
      userId: 2,
      agentKey: "coach",
      feature: "tip",
      model: "fast",
      promptVersion: "v1",
      knowledgeVersion: "k1",
      crmContextVersion: "c1",
      messages: [{ role: "user", content: "hello" }],
    });
    const task = () =>
      coalesceTenantAiRequest(key, async () => {
        calls += 1;
        await Promise.resolve();
        return "done";
      });
    expect(await Promise.all([task(), task(), task()])).toEqual([
      "done",
      "done",
      "done",
    ]);
    expect(calls).toBe(1);
  });

  it("never shares across organisations", () => {
    const common = {
      userId: 2,
      agentKey: "coach",
      feature: "tip",
      model: "fast",
      promptVersion: "v1",
      knowledgeVersion: "k1",
      crmContextVersion: "c1",
      messages: [],
    };
    expect(tenantAiRequestKey({ ...common, organisationId: 1 })).not.toBe(
      tenantAiRequestKey({ ...common, organisationId: 2 })
    );
  });
});
