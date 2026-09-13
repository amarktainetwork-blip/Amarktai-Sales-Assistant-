import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("canonical Genie operation precedence", () => {
  it("does not let generic adapter-map candidates supersede canonical pack operations", () => {
    const source = readFileSync(
      new URL("./automaticCommissioning.ts", import.meta.url),
      "utf8"
    );
    expect(source).toContain(
      "const canonicalOperationKeys = new Set("
    );
    expect(source).toContain(
      "canonicalOperationKeys.has(operationKey)"
    );
  });
});
