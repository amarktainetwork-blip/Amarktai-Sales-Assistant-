import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function clientFiles(root: string): string[] {
  return readdirSync(root).flatMap(name => {
    const target = path.join(root, name);
    if (statSync(target).isDirectory()) return clientFiles(target);
    if (/\.test\.(?:ts|tsx)$/.test(target)) return [];
    return /\.(?:ts|tsx|css|html)$/.test(target) ? [target] : [];
  });
}

describe("AmarktAI customer-facing branding boundary", () => {
  it("does not expose upstream intelligence provider or model branding anywhere in the client", () => {
    const root = path.resolve(process.cwd(), "client");
    const combined = clientFiles(root)
      .map(file => `\n/* ${path.relative(root, file)} */\n${readFileSync(file, "utf8")}`)
      .join("\n");

    expect(combined).not.toMatch(/\bGenX\b/i);
    expect(combined).not.toMatch(/\bGroq\b/i);
    expect(combined).not.toMatch(/\bTogether(?:\.ai|\s+AI)\b/i);
    expect(combined).not.toMatch(/\bMiMo\b/i);
    expect(combined).not.toMatch(/\bDeepInfra\b/i);
    expect(combined).not.toMatch(/gpt-5\.6-terra/i);
    expect(combined).not.toMatch(/\bwhisper(?:\.cpp)?\b/i);
    expect(combined).not.toMatch(/\bPiper\b/i);
  });

  it("keeps the shared visible wordmark as AmarktAI with AI in the brand-blue span", () => {
    const mark = readFileSync(
      path.resolve(process.cwd(), "client/src/components/BrandMark.tsx"),
      "utf8"
    );
    const inline = readFileSync(
      path.resolve(process.cwd(), "client/src/components/BrandName.tsx"),
      "utf8"
    );
    expect(mark).toContain('Amarkt<span className="text-[#2F6FED]">AI</span>');
    expect(mark).not.toContain(">ai</span>");
    expect(inline).toContain('Amarkt<span className="amk-brand-name__ai">AI</span>');
  });

  it("keeps the static public HTML shell on canonical AmarktAI branding and homepage metadata", () => {
    const shell = readFileSync(path.resolve(process.cwd(), "client/index.html"), "utf8");
    expect(shell).toContain("<title>AmarktAI Sales Assistant | Keep your CRM. Make the sales day easier.</title>");
    expect(shell).toContain('content="AmarktAI learns your business, works with the customer context in your CRM, helps before and during sales conversations and carries confirmed next steps into follow-through."');
    expect(shell).not.toContain("Amarktai Sales Assistant");
  });
});
