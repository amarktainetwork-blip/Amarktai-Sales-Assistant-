export type ExportFormat = "csv" | "pdf";
export type ExportSection = {
  title: string;
  columns: string[];
  rows: Array<Array<string | number | boolean | Date | null | undefined>>;
};

function cell(value: string | number | boolean | Date | null | undefined) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).replace(/\r?\n/g, " ").trim();
}

function csvValue(value: string | number | boolean | Date | null | undefined) {
  const normalized = cell(value);
  return /[",\n\r]/.test(normalized) ? `"${normalized.replaceAll('"', '""')}"` : normalized;
}

export function buildCsv(sections: ExportSection[]) {
  return sections.flatMap(section => [
    section.title,
    section.columns.map(csvValue).join(","),
    ...section.rows.map(row => row.map(csvValue).join(",")),
    "",
  ]).join("\r\n");
}

function escapePdf(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapLine(value: string, width = 104) {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > width && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export function buildSimplePdf(title: string, sections: ExportSection[]) {
  const lines = [title, `Generated ${new Date().toISOString()}`, ""];
  for (const section of sections) {
    lines.push(section.title);
    lines.push(section.columns.join(" | "));
    lines.push(...section.rows.flatMap(row => wrapLine(row.map(cell).join(" | "))));
    lines.push("");
  }
  const pageLines = 48;
  const chunks = Array.from({ length: Math.max(1, Math.ceil(lines.length / pageLines)) }, (_, index) => lines.slice(index * pageLines, (index + 1) * pageLines));
  const objects: string[] = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const pageObjectIds = chunks.map((_, index) => 4 + index * 2);
  objects[1] = `<< /Type /Pages /Kids [${pageObjectIds.map(id => `${id} 0 R`).join(" ")}] /Count ${chunks.length} >>`;
  for (let index = 0; index < chunks.length; index += 1) {
    const pageId = pageObjectIds[index];
    const contentId = pageId + 1;
    const text = chunks[index].map((line, lineIndex) => `${lineIndex === 0 ? "" : "T*\n"}(${escapePdf(line)}) Tj`).join("\n");
    const stream = `BT\n/F1 10 Tf\n40 800 Td\n13 TL\n${text}\nET`;
    objects[pageId - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId - 1] = `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`;
  }
  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets[index + 1] = Buffer.byteLength(output, "utf8"); output += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(output, "utf8");
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output, "utf8");
}

export function createExportDownload(input: { title: string; filenameStem: string; format: ExportFormat; sections: ExportSection[] }) {
  const bytes = input.format === "csv" ? Buffer.from(buildCsv(input.sections), "utf8") : buildSimplePdf(input.title, input.sections);
  return {
    filename: `${input.filenameStem}.${input.format}`,
    contentType: input.format === "csv" ? "text/csv;charset=utf-8" : "application/pdf",
    base64: bytes.toString("base64"),
  };
}
