import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const settings = readFileSync(
  new URL("../client/src/pages/Settings.tsx", import.meta.url),
  "utf8"
);
const routes = readFileSync(
  new URL("./autonomyRoutes.ts", import.meta.url),
  "utf8"
);

describe("permanent autonomy settings", () => {
  it("lets each user review and change all requested autonomy groups later", () => {
    expect(settings).toContain("data-autonomy-settings");
    for (const label of [
      "Review everything",
      "Custom autonomy",
      "Full autonomy",
      "Email replies",
      "New emails",
      "SMS",
      "WhatsApp",
      "CRM notes",
      "Tasks & callbacks",
      "Customer & contact updates",
      "Opportunity & stage updates",
      "Calendar invites",
      "Sequences & follow-ups",
    ])
      expect(settings).toContain(label);
    expect(settings).toContain('method: "PUT"');
  });

  it("updates only the signed-in user's organisation-scoped preferences", () => {
    expect(routes).toContain("requireLocalHttpContext(req)");
    expect(routes).toContain("userId,");
    expect(routes).toContain("organisationId: membership.organisationId");
    expect(routes).not.toContain("req.body?.userId");
  });
});
