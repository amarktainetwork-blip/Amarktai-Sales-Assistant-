import { describe, expect, it } from "vitest";
import {
  buildBusinessBasicsApproval,
  businessBasicsCounts,
  containsCommercialKnowledge,
  websiteKnowledgePassesCommercialApprovalPolicy,
} from "./companyKnowledgeApprovalPolicy";

describe("company knowledge business-basics approval policy", () => {
  it("keeps useful offering description while stripping website-derived commercial claims", () => {
    const items = buildBusinessBasicsApproval([
      {
        title: "CompTIA A+ (Core 1 & 2) Course & Certification",
        content:
          "Prepare for the CompTIA A+ Core 1 and Core 2 certification exams with guided technology training. Full current price: £529. Finance available.",
        category: "individual_courses",
        reviewState: "review_required",
        trustEligible: true,
        sourceUrl: "https://example.test/comptia-a-plus",
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
          "Prepare for the CompTIA A+ Core 1 and Core 2 certification exams with guided technology training.",
        sourceUrl: "https://example.test/comptia-a-plus",
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

  it("preserves safe descriptive company, credential and contact facts", () => {
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

    expect(items[0].content).toBe(
      "Course2Career provides technology and project management training."
    );
    expect(items[1].content).toBe(
      "The website identifies Course2Career as a CompTIA Training Partner."
    );
    expect(items[2].content).toContain("support@example.test");
    expect(businessBasicsCounts(items)).toEqual({
      company: 1,
      offerings: 0,
      credentials: 1,
      contact: 1,
      sales: 0,
    });
  });

  it("retains useful non-commercial sales, support, FAQ and policy knowledge", () => {
    const items = buildBusinessBasicsApproval([
      {
        title: "Learner support",
        content: "Learners receive tutor support throughout their studies.",
        category: "support_outcomes",
      },
      {
        title: "Who are programmes for?",
        content: "Programmes are designed for people building career-ready skills.",
        category: "faqs",
      },
      {
        title: "Sales guidance",
        content: "Career programmes combine guided learning with certification preparation.",
        category: "sales_facts",
      },
      {
        title: "Study access",
        content: "Online learning resources can be accessed through the learner portal. Refund fees are described separately.",
        category: "policies",
      },
    ]);

    expect(items).toHaveLength(4);
    expect(items.every(item => item.group === "sales")).toBe(true);
    expect(items[3].content).toBe(
      "Online learning resources can be accessed through the learner portal."
    );
    expect(businessBasicsCounts(items).sales).toBe(4);
  });

  it("supports generic offering categories without company-specific hard coding", () => {
    const categories = ["programmes", "courses", "products", "services", "solutions", "subscriptions", "packages", "plans", "offerings"];
    const items = buildBusinessBasicsApproval(
      categories.map((category, index) => ({
        title: `Offering ${index + 1}`,
        content: `Offering ${index + 1} helps a customer solve a defined need.`,
        category,
      }))
    );
    expect(items).toHaveLength(categories.length);
    expect(items.every(item => item.group === "offerings")).toBe(true);
  });

  it("falls back to a neutral offering identity only when no safe description remains", () => {
    const items = buildBusinessBasicsApproval([
      {
        title: "Course A",
        content: "Course A costs £229. Finance is available.",
        category: "individual_courses",
        offering: { name: "Course A", type: "individual_course" },
        priceFacts: [{ value: "£229" }],
      },
    ]);
    expect(items[0].content).toBe(
      "Course A is an individual course offered by the business."
    );
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
