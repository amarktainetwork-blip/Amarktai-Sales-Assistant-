import { describe, expect, it } from "vitest";
import {
  buildCompanyCorpus,
  diffCompanyCorpus,
} from "./companyKnowledgeCorpus";

function page(url: string, text: string) {
  return {
    url,
    title: text.split(" ").slice(0, 3).join(" "),
    fetchedAt: "2026-08-28T00:00:00.000Z",
    text,
    category: "courses",
    headings: [text.split(".")[0]],
    links: [],
    jsonLd: [],
  };
}

describe("canonical whole-site company corpus", () => {
  it("assigns stable source IDs and records corpus hashes", () => {
    const corpus = buildCompanyCorpus(
      [
        page(
          "https://example.test/z",
          "Zulu service. Complete useful content."
        ),
        page(
          "https://example.test/a",
          "Alpha course. Complete useful content."
        ),
      ],
      "2026-08-28T00:00:00.000Z"
    );
    expect(corpus.pages.map(item => [item.pageId, item.url])).toEqual([
      ["PAGE_0001", "https://example.test/a"],
      ["PAGE_0002", "https://example.test/z"],
    ]);
    expect(corpus.byteSize).toBe(Buffer.byteLength(corpus.jsonl));
    expect(corpus.corpusHash).toMatch(/^[a-f0-9]{64}$/);
    expect(corpus.sourceHashes).toHaveLength(2);
  });

  it("collapses only exact normalized duplicates and retains template-similar substantive pages", () => {
    const corpus = buildCompanyCorpus([
      page(
        "https://example.test/course/a",
        "Shared template. Alpha course costs £719."
      ),
      page(
        "https://example.test/course/a-copy",
        "Shared template. Alpha course costs £719."
      ),
      page(
        "https://example.test/course/b",
        "Shared template. Beta course costs £1,029."
      ),
    ]);
    expect(corpus.pages).toHaveLength(2);
    expect(corpus.pages[0].duplicateUrls).toEqual([
      "https://example.test/course/a-copy",
    ]);
    expect(corpus.pages.some(item => item.text.includes("Beta course"))).toBe(
      true
    );
  });

  it("provides the canonical hash delta foundation for cheap refreshes", () => {
    const before = buildCompanyCorpus([
      page("https://example.test/a", "Alpha £719"),
      page("https://example.test/b", "Beta £1,029"),
    ]);
    const after = buildCompanyCorpus([
      page("https://example.test/a", "Alpha £719"),
      page("https://example.test/b", "Beta £1,095 changed"),
      page("https://example.test/c", "Gamma £1,799"),
    ]);
    const delta = diffCompanyCorpus(before, after);
    expect(delta.unchanged).toHaveLength(1);
    expect(delta.changed).toHaveLength(1);
    expect(delta.added).toHaveLength(1);
    expect(delta.removed).toHaveLength(0);
  });
});
