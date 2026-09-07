import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("approved communication templates cost zero AI", () => {
  it("materialises the exact configured template before the only generative branch", () => {
    const source = readFileSync(
      new URL("./assistantDirectActions.ts", import.meta.url),
      "utf8"
    );
    const templateBranch = source.indexOf("if (configuredTemplate)");
    const materialize = source.indexOf(
      "materializeConfiguredTemplate",
      templateBranch
    );
    const generativeBranch = source.indexOf("} else {", materialize);
    const modelCall = source.indexOf("runGenxAgent({", generativeBranch);
    expect(templateBranch).toBeGreaterThan(0);
    expect(materialize).toBeGreaterThan(templateBranch);
    expect(generativeBranch).toBeGreaterThan(materialize);
    expect(modelCall).toBeGreaterThan(generativeBranch);
    expect(source.slice(templateBranch, generativeBranch)).not.toContain(
      "runGenxAgent({"
    );
  });
});
