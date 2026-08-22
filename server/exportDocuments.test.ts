import { describe, expect, it } from "vitest";
import { buildCsv, buildSimplePdf, createExportDownload } from "./exportDocuments";

const sections = [{ title: "Example", columns: ["Name", "Detail"], rows: [["A, B", "Line one\nLine two"]] }];

describe("workspace exports", () => {
  it("escapes CSV fields without changing the factual values", () => {
    expect(buildCsv(sections)).toContain('"A, B",Line one Line two');
  });

  it("builds a downloadable PDF with escaped text", () => {
    const pdf = buildSimplePdf("Report (review)", sections);
    expect(pdf.subarray(0, 8).toString("utf8")).toBe("%PDF-1.4");
    expect(pdf.toString("utf8")).toContain("Report \\(review\\)");
  });

  it("returns only a filename, MIME type, and encoded bytes to the client", () => {
    const download = createExportDownload({ title: "Report", filenameStem: "workspace-report", format: "csv", sections });
    expect(download).toMatchObject({ filename: "workspace-report.csv", contentType: "text/csv;charset=utf-8" });
    expect(Buffer.from(download.base64, "base64").toString("utf8")).toContain("Example");
  });
});
