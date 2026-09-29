import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./applyClientConfigurationCli.ts", import.meta.url),
  "utf8"
);

describe("client-pack commissioning CLI lifecycle", () => {
  it("terminates cleanly after flushing success output", () => {
    expect(source).toContain("process.stdout.write(");
    expect(source).toContain("process.exit(0)");
  });

  it("terminates with failure after flushing the error", () => {
    expect(source).toContain("process.stderr.write(message, () => process.exit(1))");
    expect(source).not.toContain("process.exitCode = 1");
  });
});
