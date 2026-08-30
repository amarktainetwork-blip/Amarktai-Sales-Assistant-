import { describe, expect, it } from "vitest";
import { scopeAuditDraftProvenanceForBatch } from "./companyKnowledgeInlineRuntime";

describe("bounded audit draft provenance", () => {
  it("removes every source page id that is outside the current audit batch", () => {
    const input = {
      company: {
        name: "Course2Career",
        sourcePageIds: ["PAGE_0001", "PAGE_0018"],
      },
      offerings: [
        {
          id: "programme-a",
          sourcePageIds: ["PAGE_0016", "PAGE_0018", "PAGE_0027"],
          prices: [
            {
              value: "£2,499",
              sourcePageIds: ["PAGE_0019", "PAGE_0045"],
            },
          ],
        },
      ],
      contacts: [
        {
          value: "01234 567890",
          sourcePageIds: ["PAGE_0020", "PAGE_0030"],
        },
      ],
      conflicts: [
        {
          subject: "Programme price",
          sourcePageIds: ["PAGE_0003", "PAGE_0021"],
        },
      ],
      unsupportedOnly: {
        sourcePageIds: ["PAGE_0066"],
      },
    };
    const original = structuredClone(input);

    const scoped = scopeAuditDraftProvenanceForBatch(input, [
      "PAGE_0018",
      "PAGE_0019",
      "PAGE_0020",
      "PAGE_0021",
    ]);

    expect(scoped.company.sourcePageIds).toEqual(["PAGE_0018"]);
    expect(scoped.offerings[0].sourcePageIds).toEqual(["PAGE_0018"]);
    expect(scoped.offerings[0].prices[0].sourcePageIds).toEqual([
      "PAGE_0019",
    ]);
    expect(scoped.contacts[0].sourcePageIds).toEqual(["PAGE_0020"]);
    expect(scoped.conflicts[0].sourcePageIds).toEqual(["PAGE_0021"]);
    expect(scoped.unsupportedOnly.sourcePageIds).toEqual([]);
    expect(JSON.stringify(scoped)).not.toMatch(
      /PAGE_0001|PAGE_0003|PAGE_0016|PAGE_0027|PAGE_0030|PAGE_0045|PAGE_0066/
    );
    expect(input).toEqual(original);
  });

  it("never invents replacement provenance when all ids are outside the batch", () => {
    const scoped = scopeAuditDraftProvenanceForBatch(
      {
        replaceOffering: {
          sourcePageIds: ["PAGE_0016", "PAGE_0027", "PAGE_0045"],
        },
      },
      ["PAGE_0018", "PAGE_0019", "PAGE_0020", "PAGE_0021"]
    );

    expect(scoped.replaceOffering.sourcePageIds).toEqual([]);
  });
});
