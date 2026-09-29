import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./salesTracker.ts", import.meta.url),
  "utf8"
);

describe("Sales Tracker scale contract", () => {
  it("does not truncate opportunities or preload an arbitrary contact ceiling", () => {
    expect(source).not.toContain(".limit(10_000)");
    expect(source).not.toContain(".limit(30_000)");
    expect(source).toContain("wonContactExternalIds");
    expect(source).toContain("inArray(crmContacts.externalId, wonContactExternalIds)");
  });
});
