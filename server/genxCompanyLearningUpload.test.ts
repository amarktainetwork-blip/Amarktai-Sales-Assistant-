import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("GenX company-learning attachment safety", () => {
  it("keeps file upload and file_ids out of production company-learning runtimes", () => {
    const synthesis = readFileSync(
      new URL("./companyKnowledgeSynthesis.ts", import.meta.url),
      "utf8"
    );
    const inline = readFileSync(
      new URL("./companyKnowledgeInlineRuntime.ts", import.meta.url),
      "utf8"
    );
    const partial = readFileSync(
      new URL("./companyKnowledgePartialBatchRuntime.ts", import.meta.url),
      "utf8"
    );
    const client = readFileSync(
      new URL("./genxCompanyLearning.ts", import.meta.url),
      "utf8"
    );

    expect(synthesis).not.toContain("uploadCorpus");
    expect(inline).not.toMatch(/fileIds:\s*\[[^\]]+\]/);
    expect(partial).not.toMatch(/fileIds:\s*\[[^\]]+\]/);
    expect(client).not.toContain("async uploadCorpus");
    expect(client).not.toMatch(/file_ids:\s*input/);
    expect(client).toContain("file_ids are disabled as unsafe");
  });
});
