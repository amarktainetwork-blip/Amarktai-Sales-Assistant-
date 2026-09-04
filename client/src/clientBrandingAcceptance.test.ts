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
    const mark = readFileSync(path.resolve(process.cwd(), "client/src/components/BrandMark.tsx"), "utf8");
    const inline = readFileSync(path.resolve(process.cwd(), "client/src/components/BrandName.tsx"), "utf8");
    expect(mark).toContain('Amarkt<span className="text-[#2F6FED]">AI</span>');
    expect(mark).not.toContain(">ai</span>");
    expect(inline).toContain('Amarkt<span className="amk-brand-name__ai">AI</span>');
  });

  it("keeps the static public HTML shell on canonical AmarktAI branding and current homepage metadata", () => {
    const shell = readFileSync(path.resolve(process.cwd(), "client/index.html"), "utf8");
    expect(shell).toContain("<title>AmarktAI Sales Assistant | Sell with more confidence. Follow up without the scramble.</title>");
    expect(shell).toContain('content="AmarktAI helps salespeople prepare for customers, handle conversations and finish the follow-up around the CRM they already use."');
    expect(shell).not.toContain("Amarktai Sales Assistant");
  });

  it("uses first-party product visuals instead of generic remote stock photography", () => {
    const root = path.resolve(process.cwd(), "client");
    const combined = clientFiles(root)
      .map(file => readFileSync(file, "utf8"))
      .join("\n");
    expect(combined).not.toMatch(/images\.pexels\.com/i);
    expect(combined).not.toMatch(/images\.unsplash\.com/i);
  });

  it("keeps second-factor verification on the secure auth route before workspace entry", () => {
    const auth = readFileSync(path.resolve(process.cwd(), "client/src/pages/Auth.tsx"), "utf8");
    expect(auth).toContain('/auth?step=verify');
    expect(auth).toContain("Verify your email.");
    expect(auth).not.toContain('navigate("/dashboard")');
  });
});
