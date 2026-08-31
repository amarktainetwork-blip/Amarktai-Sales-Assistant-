import { describe, expect, it } from "vitest";
import {
  buildBusinessBasicsApproval,
  businessBasicsCounts,
  containsCommercialKnowledge,
  websiteKnowledgePassesCommercialApprovalPolicy,
} from "./companyKnowledgeApprovalPolicy";

describe("company knowledge business-basics approval policy", () => {
  it("keeps offering identity while stripping website-derived prices", () => {
    const items = buildBusinessBasicsApproval([
      {
        title: "CompTIA A+ (Core 1 & 2) Course & Certification",
        content: "Full current price: £529. Finance available.",
        category: "individual_courses",
        reviewState: "review_required",
        trustEligible: true,
        offering: {
          name: "CompTIA A+ (Core 1 & 2) Course & Certification",
          type: "individual_course",
        },
        priceFacts: [{ value: "£529" }, { value: "£229" }],
      },
    ]);

    expect(items).toEqual([
      {
        index: 0,
        group: "offerings",
        title: "CompTIA A+ (Core 1 & 2) Course & Certification",
        content:
          "CompTIA A+ (Core 1 & 2) Course & Certification is a individual course offered by the business.",
      },
    ]);
    expect(containsCommercialKnowledge(items[0].content)).toBe(false);
  });

  it("does not include pricing or finance candidates in business basics", () => {
    const items = buildBusinessBasicsApproval([
      {
        title: "Current prices",
        content: "Course A costs £229.",
        category: "pricing",
      },
      {
        title: "Finance",
        content: "Pay monthly with finance.",
        category: "finance",
      },
    ]);
    expect(items).toEqual([]);
  });

  it("does not include unresolved conflicts or ambiguous candidates", () => {
    const items = buildBusinessBasicsApproval([
      {
        title: "Course A",
        content: "Course A description.",
        category: "individual_courses",
        reviewState: "conflict",
        trustEligible: false,
        offering: { name: "Course A", type: "course" },
      },
      {
        title: "Company claim",
        content: "Unclear claim.",
        category: "company",
        reviewState: "ambiguous",
      },
    ]);
    expect(items).toEqual([]);
  });

  it("keeps safe company, credential and contact facts", () => {
    const items = buildBusinessBasicsApproval([
      {
        title: "Course2Career",
        content: "Course2Career provides technology and project management training.",
        category: "company",
      },
      {
        title: "Accreditations",
        content: "The website identifies Course2Career as a CompTIA Training Partner.",
        category: "certifications",
      },
      {
        title: "Contact",
        content: "Support email: support@example.test. Opening hours: Monday to Friday.",
        category: "contact",
      },
    ]);

    expect(businessBasicsCounts(items)).toEqual({
      company: 1,
      offerings: 0,
      credentials: 1,
      contact: 1,
    });
  });

  it("blocks a commercial website candidate unless a correction removes the commercial claim", () => {
    const candidate = {
      title: "Course A",
      content: "Course A costs £229 and finance is available.",
      category: "individual_courses",
      priceFacts: [{ value: "£229" }],
    };

    expect(websiteKnowledgePassesCommercialApprovalPolicy(candidate)).toBe(false);
    expect(
      websiteKnowledgePassesCommercialApprovalPolicy(candidate, {
        title: "Course A",
        content: "Course A is an individual course offered by the business.",
      })
    ).toBe(true);
    expect(
      websiteKnowledgePassesCommercialApprovalPolicy(candidate, {
        title: "Course A",
        content: "Course A is offered for £229.",
      })
    ).toBe(false);
  });

  it("never promotes a pricing/finance category through website confirmation", () => {
    const candidate = {
      title: "Finance options",
      content: "Finance is available.",
      category: "finance",
    };
    expect(
      websiteKnowledgePassesCommercialApprovalPolicy(candidate, {
        title: "Finance options",
        content: "Finance details are available separately.",
      })
    ).toBe(false);
  });
});
