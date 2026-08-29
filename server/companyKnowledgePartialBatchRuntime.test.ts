import { describe, expect, it } from "vitest";
import { buildCompanyCorpus } from "./companyKnowledgeCorpus";
import {
  mergePartialCompanyKnowledgeBatches,
  parsePartialCompanyKnowledgeBatch,
} from "./companyKnowledgePartialBatchRuntime";

function corpus() {
  return buildCompanyCorpus(
    [
      {
        url: "https://www.course2career.com/",
        title: "Course2Career",
        fetchedAt: "2026-08-29T00:00:00.000Z",
        text: "Course2Career provides online IT training and career programmes.",
        category: "company",
        description: "Course2Career training",
        headings: ["Course2Career"],
        links: ["https://www.course2career.com/courses/example"],
        jsonLd: [],
      },
      {
        url: "https://www.course2career.com/courses/example",
        title: "Example Course",
        fetchedAt: "2026-08-29T00:00:00.000Z",
        text: "Example Course costs £999 and includes tutor support.",
        category: "course",
        description: "Example Course",
        headings: ["Example Course"],
        links: [],
        jsonLd: [],
      },
    ],
    "2026-08-29T00:00:00.000Z"
  );
}

function offeringPartial() {
  return {
    offerings: [
      {
        id: "example-course",
        name: "Example Course",
        type: "individual_course",
        description: "Example Course",
        plans: [],
        prices: [
          {
            value: "£999",
            semanticType: "full_current_price",
            label: "Course price",
            sourcePageIds: ["PAGE_0002"],
          },
        ],
        duration: [],
        includedCourses: [],
        includedExams: [],
        certifications: [],
        awardingBodies: [],
        financeOptions: [],
        support: ["tutor support"],
        targetCustomer: "",
        entryRequirements: [],
        outcomes: [],
        caveats: [],
        sourcePageIds: ["PAGE_0002"],
      },
    ],
  };
}

describe("partial company-learning batch schema", () => {
  it("accepts a useful batch with no company identity", () => {
    const parsed = parsePartialCompanyKnowledgeBatch(
      JSON.stringify(offeringPartial())
    );
    expect(parsed.company).toBeUndefined();
    expect(parsed.offerings).toHaveLength(1);
  });

  it("removes blank company and placeholder records without inventing facts", () => {
    const parsed = parsePartialCompanyKnowledgeBatch(
      JSON.stringify({
        company: { name: "", legalName: "", description: "", sourcePageIds: [] },
        contacts: [{ type: "email", value: "", label: "", sourcePageIds: [] }],
        finance: [{ title: "", details: "", sourcePageIds: [] }],
        sourceIndex: { PAGE_0001: "https://..." },
        ...offeringPartial(),
      })
    );
    expect(parsed.company).toBeUndefined();
    expect(parsed.contacts).toEqual([]);
    expect(parsed.finance).toEqual([]);
    expect(parsed.sourceIndex).toEqual({});
    expect(parsed.offerings).toHaveLength(1);
  });

  it("fills only missing batch identity from a real sourced identity before deterministic merge", () => {
    const built = corpus();
    const identity = parsePartialCompanyKnowledgeBatch(
      JSON.stringify({
        company: {
          name: "Course2Career",
          legalName: "",
          description: "online IT training",
          sourcePageIds: ["PAGE_0001"],
        },
      })
    );
    const offering = parsePartialCompanyKnowledgeBatch(
      JSON.stringify(offeringPartial())
    );
    const merged = mergePartialCompanyKnowledgeBatches(
      [identity, offering],
      built
    );
    expect(merged.company.name).toBe("Course2Career");
    expect(merged.offerings).toHaveLength(1);
    expect(merged.offerings[0].name).toBe("Example Course");
    expect(merged.sourceIndex.PAGE_0001).toBe("https://www.course2career.com/");
    expect(merged.sourceIndex.PAGE_0002).toBe(
      "https://www.course2career.com/courses/example"
    );
  });

  it("rejects a batch set that never yields a source-grounded company identity", () => {
    const built = corpus();
    const offering = parsePartialCompanyKnowledgeBatch(
      JSON.stringify(offeringPartial())
    );
    expect(() => mergePartialCompanyKnowledgeBatches([offering], built)).toThrow(
      /source-grounded company identity/i
    );
  });
});
