import { describe, expect, it } from "vitest";
import { deriveCustomerInterest } from "./customerInterest";

const mappings = [
  {
    sourceFieldId: "interest-field",
    label: "Courses of interest",
    kind: "text" as const,
    purpose: "interest",
  },
];

describe("deriveCustomerInterest", () => {
  it("uses the mapped interest field as the primary source", () => {
    const result = deriveCustomerInterest({
      mappings,
      attributes: {
        customFields: { "interest-field": "Cyber Security" },
        tags: ["course — it support technician"],
      },
    });
    expect(result.primary).toBe("Cyber Security");
    expect(result.source).toBe("mapped_field");
    expect(result.values).toEqual(["Cyber Security", "it support technician"]);
  });
  it("does not mistake training timeframe for course interest and lets course tags update the interest", () => {
    const result = deriveCustomerInterest({
      mappings: [
        ...mappings,
        {
          sourceFieldId: "timeframe-field",
          label: "Training Start Timeframe",
          kind: "text" as const,
          purpose: "timing",
        },
      ],
      attributes: {
        customFields: { "timeframe-field": "As soon as possible" },
        tags: [
          "meta lead — higher intent test",
          "course — it support technician",
        ],
      },
    });
    expect(result.primary).toBe("it support technician");
    expect(result.source).toBe("tag");
    expect(result.values).toEqual(["it support technician"]);
  });

  it("falls back to an explicit course tag", () => {
    const result = deriveCustomerInterest({
      mappings,
      attributes: {
        customFields: {},
        tags: ["course — cyber security"],
      },
    });
    expect(result.primary).toBe("cyber security");
    expect(result.source).toBe("tag");
  });

  it("accepts a clearly programme-like landing-page topic", () => {
    const result = deriveCustomerInterest({
      mappings,
      attributes: {
        customFields: {},
        tags: ["project management landing page"],
      },
    });
    expect(result.primary).toBe("project management");
  });

  it("does not misclassify payment, sold or campaign tags as courses", () => {
    const result = deriveCustomerInterest({
      mappings,
      attributes: {
        customFields: {},
        tags: [
          "sold finance",
          "sold full payment",
          "meta lead — higher intent test",
          "black friday 2025",
        ],
      },
    });
    expect(result.primary).toBeNull();
    expect(result.courseTags).toEqual([]);
  });
  it("can use a labelled programme form field without hard-coding a course catalogue", () => {
    const result = deriveCustomerInterest({
      mappings,
      attributes: {
        customFields: { "form-field": "IT Support Technician" },
        customFieldLabels: { "form-field": "ELCAS course form" },
        tags: [],
      },
    });
    expect(result.primary).toBe("IT Support Technician");
    expect(result.source).toBe("form_field");
  });
});

describe("fresh generic interest evidence", () => {
  it("recomputes changed tags on each contact read", () => {
    const read = (tag: string) =>
      deriveCustomerInterest({ mappings, attributes: { tags: [tag] } }).primary;
    expect(read("course — cyber security")).toBe("cyber security");
    expect(read("course — it support technician")).toBe(
      "it support technician"
    );
  });
  it.each([
    "Form 9",
    "Form 10",
    "Facebook Ad Form",
    "ELCAS form",
    "Training Start Timeframe",
    "Best Time to Call",
    "IT Experience",
  ])("does not infer a course from %s", label => {
    expect(
      deriveCustomerInterest({
        mappings: [{ sourceFieldId: "f", label, kind: "text" }],
        attributes: { customFields: { f: "As soon as possible" } },
      }).primary
    ).toBeNull();
  });
  it("supports a future client's explicit interest mapping", () => {
    expect(
      deriveCustomerInterest({
        mappings: [
          {
            sourceFieldId: "future",
            label: "Preferred service",
            kind: "text",
            purpose: "interest",
          },
        ],
        attributes: { customFields: { future: "Business coaching" } },
      }).primary
    ).toBe("Business coaching");
  });
});

it("recognizes an unambiguous plural label without a client-specific field ID", () => {
  expect(
    deriveCustomerInterest({
      mappings: [
        { sourceFieldId: "x", label: "Courses of interest", kind: "text" },
      ],
      attributes: { customFields: { x: "Data analysis" } },
    }).primary
  ).toBe("Data analysis");
});
