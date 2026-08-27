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

describe("Amarktai customer-facing branding boundary", () => {
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
});
