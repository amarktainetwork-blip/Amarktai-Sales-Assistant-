import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getPersonalMailboxReadiness,
  validatePersonalMailboxEmailPreview,
} from "./personalMailbox";

describe("canonical personal mailbox boundary", () => {
  it("validates review previews without an application sender", () => {
    expect(
      validatePersonalMailboxEmailPreview({
        to: "lead@example.test",
        subject: "Follow-up",
        body: "Hello",
      })
    ).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([expect.stringContaining("template")]),
    });
  });

  it("reports delegated configuration without claiming user consent", () => {
    const keys = [
      "OUTLOOK_DELEGATED_TENANT_ID",
      "OUTLOOK_DELEGATED_CLIENT_ID",
      "OUTLOOK_DELEGATED_CLIENT_SECRET",
      "OUTLOOK_DELEGATED_REDIRECT_URI",
    ] as const;
    const previous = Object.fromEntries(
      keys.map(key => [key, process.env[key]])
    );
    try {
      process.env.OUTLOOK_DELEGATED_TENANT_ID = "common";
      process.env.OUTLOOK_DELEGATED_CLIENT_ID = "client";
      process.env.OUTLOOK_DELEGATED_CLIENT_SECRET = "secret";
      process.env.OUTLOOK_DELEGATED_REDIRECT_URI =
        "https://sales.example.test/api/mailbox/microsoft/callback";
      expect(getPersonalMailboxReadiness()).toMatchObject({
        ready: true,
        provider: "microsoft",
        connectionModel: "per_user_delegated_oauth",
        requiresUserConsent: true,
      });
    } finally {
      for (const key of keys) {
        const value = previous[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("has no executable shared Outlook runtime or inbound endpoint", () => {
    const core = readFileSync(path.resolve("server/_core/index.ts"), "utf8");
    const verifier = readFileSync(
      path.resolve("server/verifyIntegrations.ts"),
      "utf8"
    );
    expect(core).not.toContain("registerOutlookInboundRoutes");
    expect(core).not.toContain("/api/outlook/inbound");
    expect(verifier).not.toContain("createOutlookApplicationToken");
    expect(verifier).toContain("DELEGATED_OAUTH_CONFIGURED");
  });
});
