import { describe, expect, it } from "vitest";
import { mergeCompanyKnowledgeProgress } from "./companyKnowledgeJobs";

describe("company knowledge progress preservation", () => {
  it("keeps website page counters while later synthesis phases update status", () => {
    const crawled = {
      phase: "normalising",
      humanStatus: "Building company corpus",
      discoveredPages: 53,
      totalPagesKnown: 53,
      processedPages: 53,
      failedPages: 0,
      pagesScanned: 53,
    };

    const analysing = mergeCompanyKnowledgeProgress(crawled, {
      phase: "analysing",
      humanStatus: "Checking products and pricing",
      analysisComplete: true,
    });
    const ready = mergeCompanyKnowledgeProgress(analysing, {
      phase: "ready",
      humanStatus: "Ready for review",
      knowledgePersisted: false,
    });

    expect(ready).toMatchObject({
      phase: "ready",
      humanStatus: "Ready for review",
      discoveredPages: 53,
      totalPagesKnown: 53,
      processedPages: 53,
      failedPages: 0,
      pagesScanned: 53,
      analysisComplete: true,
    });
  });

  it("allows new progress values to advance without dropping existing evidence", () => {
    expect(
      mergeCompanyKnowledgeProgress(
        { processedPages: 12, totalPagesKnown: 40, failedPages: 1 },
        { processedPages: 16, currentHost: "course2career.com" }
      )
    ).toEqual({
      processedPages: 16,
      totalPagesKnown: 40,
      failedPages: 1,
      currentHost: "course2career.com",
    });
  });
});
