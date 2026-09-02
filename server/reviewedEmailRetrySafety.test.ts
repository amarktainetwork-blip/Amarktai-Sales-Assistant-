import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("reviewed delegated email retry safety", () => {
  it("does not encourage resend after Microsoft accepted an email without verified Sent Items readback", () => {
    const routerSource = readFileSync(
      path.resolve(process.cwd(), "server/routers.ts"),
      "utf8"
    );
    const executorSource = readFileSync(
      path.resolve(process.cwd(), "server/crm/canonicalActionExecution.ts"),
      "utf8"
    );

    expect(executorSource).toContain("acceptedByProvider: true");
    expect(executorSource).toContain("reconcile before any retry");
    expect(routerSource).toContain("executionEvidence.acceptedByProvider");
    expect(routerSource).toContain("Do not resend it until the stable action reference is reconciled.");
  });
});
