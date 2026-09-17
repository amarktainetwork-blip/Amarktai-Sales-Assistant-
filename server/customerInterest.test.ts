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
    expect(result.values).toEqual([
      "Cyber Security",
      "it support technician",
    ]);
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
        customFieldLabels: { "form-field": "ELCAS form" },
        tags: [],
      },
    });
    expect(result.primary).toBe("IT Support Technician");
    expect(result.source).toBe("form_field");
  });
});
