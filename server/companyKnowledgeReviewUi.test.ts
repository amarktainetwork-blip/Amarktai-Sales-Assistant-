import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../client/src/pages/CompanySetup.tsx", import.meta.url),
  "utf8"
);
const knowledge = readFileSync(
  new URL("../client/src/pages/Knowledge.tsx", import.meta.url),
  "utf8"
);

describe("company knowledge report review", () => {
  it("shows a report before exposing specific correction controls", () => {
    expect(source).toContain("data-company-knowledge-report");
    expect(source).toContain("Here is what I understood.");
    expect(source).toContain("editing ?");
    expect(source.indexOf("editing ?")).toBeLessThan(source.indexOf("<Input"));
    expect(source).toContain("Edit what needs changing");
  });

  it("covers the manager-facing business understanding contract", () => {
    for (const heading of [
      "About your business",
      "Primary sales focus",
      "What you sell",
      "Other products &amp; services",
      "Who you sell to",
      "Credentials & trust",
      "Customer support & contact",
      "Important commercial information",
      "Sources",
      "Is this an accurate understanding of your business?",
      "Confirm business knowledge",
    ])
      expect(source).toContain(heading);
    expect(source).toContain("buildSalesFocusSuggestions");
    expect(source).toContain("selectedFocus");
    expect(source).toContain("Manager-confirmed primary sales focus.");
  });

  it("lets an authorised manager refresh without overwriting trusted facts", () => {
    expect(knowledge).toContain("Refresh website knowledge");
    expect(knowledge).toContain("discoverWebsite.useMutation");
    expect(knowledge).toContain("New findings will wait for review.");
    expect(knowledge).toContain("Existing trusted knowledge was not changed.");
  });
});
