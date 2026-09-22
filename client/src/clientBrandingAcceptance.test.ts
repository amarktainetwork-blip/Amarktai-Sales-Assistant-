import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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
      .map(
        file =>
          `\n/* ${path.relative(root, file)} */\n${readFileSync(file, "utf8")}`
      )
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
    expect(mark).toContain('Amarkt<span className="text-[#5E8CFF]">AI</span>');
    expect(mark).not.toContain(">ai</span>");
    expect(inline).toContain(
      'Amarkt<span className="amk-brand-name__ai">AI</span>'
    );
  });

  it("keeps the static public HTML shell on canonical AmarktAI branding and current homepage metadata", () => {
    const shell = readFileSync(
      path.resolve(process.cwd(), "client/index.html"),
      "utf8"
    );
    expect(shell.replace(/\s+/g, " ")).toContain(
      "<title>AmarktAI Sales Assistant | Sell More. Admin Less.</title>"
    );
    expect(shell).toContain(
      'content="AmarktAI learns how your company sells, works around the CRM you already use, prepares customer conversations and gets the follow-through ready while the salesperson stays in control."'
    );
    expect(shell).toContain('name="theme-color" content="#0B1118"');
    expect(shell).not.toContain("Amarktai Sales Assistant");
  });

  it("uses local editorial photography and one canonical visual system", () => {
    const css = readFileSync(
      path.resolve(process.cwd(), "client/src/index.css"),
      "utf8"
    );
    const visibleSources = [
      "client/src/marketing/HomePage.tsx",
      "client/src/marketing/AboutPage.tsx",
      "client/src/marketing/SecondaryPages.tsx",
      "client/src/marketing/ContactPage.tsx",
      "client/src/pages/Auth.tsx",
    ]
      .map(file => readFileSync(path.resolve(process.cwd(), file), "utf8"))
      .join("\n");
    const imagery = readFileSync(
      path.resolve(process.cwd(), "client/src/marketing/imagery.ts"),
      "utf8"
    );
    const publicImageRoot = path.resolve(process.cwd(), "client/public/images");
    expect(readdirSync(publicImageRoot).sort()).toEqual(["sales"]);
    const salesImages = readdirSync(path.join(publicImageRoot, "sales")).sort();
    expect(salesImages).toHaveLength(12);
    expect(salesImages.every(file => file.endsWith(".webp"))).toBe(true);
    const mappedPaths = Array.from(
      imagery.matchAll(/src:\s*"([^"]+)"/g),
      match => match[1]
    );
    expect(mappedPaths).toHaveLength(12);
    expect(new Set(mappedPaths).size).toBe(12);
    expect(visibleSources).not.toMatch(/images\.pexels\.com/i);
    expect(visibleSources).not.toMatch(/images\.unsplash\.com/i);
    expect(visibleSources).toContain("MarketingArtwork");
    expect(imagery).toContain("/images/sales/");
    expect(imagery).not.toContain("/images/editorial-v2/");
    expect(imagery).not.toContain("/images/people/");
    expect(imagery).not.toMatch(/ai-generated/i);
    expect(css).toContain(".amk-brand-art");
    expect(css).toContain(".amk-brand-name__ai{color:var(--site-blue,#5E8CFF)}");
    expect(css).toContain(".amk-site main{display:grid;gap:5px");
    expect(css).toContain("filter:none");
    expect(css).toContain(".amk-auth__message h1");
    expect(css).not.toContain("content: url(");
  });

  it("keeps second-factor verification on the secure auth route before workspace entry", () => {
    const auth = readFileSync(
      path.resolve(process.cwd(), "client/src/pages/Auth.tsx"),
      "utf8"
    );
    expect(auth).toContain("/auth?step=verify");
    expect(auth).toContain("Verify your email.");
    expect(auth).toContain('window.location.assign("/auth?step=verify")');
    expect(auth).toContain(
      "if (!user || !security.data?.verified || invite || reset) return;"
    );
    expect(auth).toContain('navigate("/dashboard", { replace: true });');
  });
});
