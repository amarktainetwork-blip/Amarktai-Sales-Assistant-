import { describe, expect, it } from "vitest";
import {
  buildBusinessBasicsApproval,
  buildSalesFocusSuggestions,
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

  it("preserves sourced non-commercial company and offering descriptions", () => {
    const items = buildBusinessBasicsApproval([
      {
        title: "Example Co",
        content: "Example Co helps growing businesses train new managers.",
        category: "company",
      },
      {
        title: "Leadership Programme",
        content: "£499 with monthly finance.",
        category: "products_services",
        priceFacts: [{ value: "£499" }],
        offering: {
          name: "Leadership Programme",
          type: "service",
          description: "A structured programme for first-time managers.",
          targetCustomer: "New and aspiring managers",
          outcomes: ["Build practical leadership confidence"],
        },
      },
    ]);

    expect(items[0].content).toBe(
      "Example Co helps growing businesses train new managers."
    );
    expect(items[1].content).toContain(
      "A structured programme for first-time managers."
    );
    expect(items[1].content).toContain(
      "Best suited to: New and aspiring managers"
    );
    expect(items[1].content).toContain(
      "Outcomes: Build practical leadership confidence"
    );
    expect(containsCommercialKnowledge(items[1].content)).toBe(false);
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
        content:
          "Course2Career provides technology and project management training.",
        category: "company",
      },
      {
        title: "Accreditations",
        content:
          "The website identifies Course2Career as a CompTIA Training Partner.",
        category: "certifications",
      },
      {
        title: "Contact",
        content:
          "Support email: support@example.test. Opening hours: Monday to Friday.",
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

  it("collapses equivalent regulation, phone and operating-hours facts for review", () => {
    const items = buildBusinessBasicsApproval([
      {
        title: "FCA status",
        content: "Course2Career is an Introducer Appointed Representative.",
        category: "certifications",
      },
      {
        title: "Financial Conduct Authority",
        content:
          "The business states that it is an FCA Introducer Appointed Representative.",
        category: "company_certification",
      },
      {
        title: "Main phone",
        content: "Call +44 (0) 20 1234 5678.",
        category: "contact",
      },
      {
        title: "Telephone",
        content: "Phone: +44 20 1234 5678",
        category: "contact",
      },
      {
        title: "Opening hours",
        content: "Monday to Friday, 09:00 to 17:00.",
        category: "contact",
      },
      {
        title: "Operating hours",
        content: "Business hours are Monday to Friday, 09:00–17:00.",
        category: "contact",
      },
    ]);

    expect(items.filter(item => item.group === "credentials")).toHaveLength(1);
    expect(items.filter(item => item.group === "contact")).toHaveLength(2);
  });

  it("collapses formatting-equivalent catalogue entries without collapsing different courses", () => {
    const items = buildBusinessBasicsApproval([
      {
        title: "Cyber Security Career Programme",
        content: "Cyber programme.",
        category: "career_programmes",
        offering: { name: "Cyber Security Career Programme" },
      },
      {
        title: "Cyber Security Training Program",
        content: "Equivalent cyber programme.",
        category: "individual_courses",
        offering: { name: "Cyber Security Training Program" },
      },
      {
        title: "Data Analytics Course",
        content: "Data course.",
        category: "individual_courses",
        offering: { name: "Data Analytics Course" },
      },
    ]);
    expect(items.filter(item => item.group === "offerings")).toHaveLength(2);
  });

  it("ranks sales focus by generic evidence richness rather than company-specific names", () => {
    const suggestions = buildSalesFocusSuggestions([
      {
        title: "Simple Service",
        content: "A simple service.",
        category: "products_services",
        sourcePageIds: ["PAGE_0001"],
        offering: {
          name: "Simple Service",
          type: "service",
          description: "A simple service.",
          sourcePageIds: ["PAGE_0001"],
        },
      },
      {
        title: "Professional Programme",
        content: "A detailed programme.",
        category: "products_services",
        sourcePageIds: ["PAGE_0002", "PAGE_0003", "PAGE_0004"],
        offering: {
          name: "Professional Programme",
          type: "package",
          description: "A detailed professional development programme.",
          targetCustomer: "Career changers",
          outcomes: ["Job-ready skills", "Recognised certification"],
          support: ["Tutor support"],
          includedCourses: ["Foundation", "Advanced"],
          sourcePageIds: ["PAGE_0002", "PAGE_0003", "PAGE_0004"],
        },
      },
    ]);

    expect(suggestions[0].title).toBe("Professional Programme");
    expect(suggestions[0].reason).toContain("3 website sources");
    expect(suggestions[0].score).toBeGreaterThan(suggestions[1].score);
  });

  it("blocks a commercial website candidate unless a correction removes the commercial claim", () => {
    const candidate = {
      title: "Course A",
      content: "Course A costs £229 and finance is available.",
      category: "individual_courses",
      priceFacts: [{ value: "£229" }],
    };

    expect(websiteKnowledgePassesCommercialApprovalPolicy(candidate)).toBe(
      false
    );
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
