import { describe, expect, it } from "vitest";
import { renderConfiguredTemplateText } from "./communicationContent";

describe("configured communication merge fields", () => {
  it("renders approved customer name fields from normalized CRM truth", () => {
    expect(
      renderConfiguredTemplateText(
        "Hi [First Name], thanks for your enquiry. Regards, team.",
        {
          firstName: "Jamie",
          lastName: "Test",
          fullName: "Jamie Test",
        }
      )
    ).toBe("Hi Jamie, thanks for your enquiry. Regards, team.");

    expect(
      renderConfiguredTemplateText(
        "Hello {{first_name}} — [Full Name] at [Company]",
        {
          firstName: "Jamie",
          fullName: "Jamie Test",
          companyName: "Example Ltd",
        }
      )
    ).toBe("Hello Jamie — Jamie Test at Example Ltd");
  });

  it("fails closed instead of sending a literal recognized placeholder", () => {
    expect(() =>
      renderConfiguredTemplateText("Hi [First Name], welcome.", {
        fullName: "Unknown Customer",
      })
    ).toThrow("TEMPLATE_VARIABLE_REQUIRED");
  });
});
