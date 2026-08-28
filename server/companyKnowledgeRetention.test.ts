import { describe, expect, it } from "vitest";
import { retainedPagesForCompanyReview } from "./companyIntelligenceService";

const fetchedAt = "2026-08-28T08:00:00.000Z";

describe("company knowledge retained crawl evidence", () => {
  it("keeps every metadata page when the legacy concatenated text is truncated", () => {
    const pages = retainedPagesForCompanyReview(
      "[https://example.test/first]\nfirst legacy body",
      [
        {
          url: "https://example.test/first",
          title: "First",
          fetchedAt,
          text: "first retained body",
          category: "home",
        },
        {
          url: "https://example.test/second",
          title: "Second",
          fetchedAt,
          text: "second retained body that is absent from extractedText",
          category: "courses",
        },
      ]
    );

    expect(pages).toHaveLength(2);
    expect(pages.map(page => page.url)).toEqual([
      "https://example.test/first",
      "https://example.test/second",
    ]);
    expect(pages[0].text).toBe("first retained body");
    expect(pages[1].text).toBe(
      "second retained body that is absent from extractedText"
    );
  });

  it("remains backward compatible with legacy snapshots that only have extractedText", () => {
    const pages = retainedPagesForCompanyReview(
      "[https://example.test/legacy]\nlegacy retained evidence",
      [
        {
          url: "https://example.test/legacy",
          title: "Legacy",
          fetchedAt,
          category: "about",
        },
      ]
    );

    expect(pages).toHaveLength(1);
    expect(pages[0].text).toBe("legacy retained evidence");
  });
});
