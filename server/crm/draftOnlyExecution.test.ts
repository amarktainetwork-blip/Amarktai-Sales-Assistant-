import { expect, it } from "vitest";
import { executeCanonicalApprovedAction } from "./canonicalActionExecution";
it("cannot execute an approved draft with no verified sending route", async () => {
  await expect(
    executeCanonicalApprovedAction({
      organisationId: 8,
      correlationId: "test",
      proposal: {
        id: 1,
        userId: 2,
        actionType: "send_email",
        payload: {
          draftOnly: true,
          executionReady: false,
          reviewRequired: true,
          crmRoute: { routable: false },
        },
      } as any,
    })
  ).rejects.toThrow("no verified execution route");
});
