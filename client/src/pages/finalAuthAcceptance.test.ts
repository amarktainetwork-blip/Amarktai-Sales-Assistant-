import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("final account presentation", () => {
  const auth = readFileSync(
    path.resolve(process.cwd(), "client/src/pages/Auth.tsx"),
    "utf8"
  );

  it("uses account language and the canonical AmarktAI spelling", () => {
    expect(auth).toContain("CREATE ACCOUNT");
    expect(auth).toContain("Create your AmarktAI account.");
    expect(auth).toContain("Create account");
    expect(auth).not.toContain("Create your Amarktai account.");
    expect(auth).not.toContain("CREATE WORKSPACE");
    expect(auth).not.toContain("Create your Sales Assistant workspace.");
  });

  it("reacts to register, forgot-password and sign-in query links", () => {
    expect(auth).toContain('import { Link, useLocation, useSearch } from "wouter";');
    expect(auth).toContain("const search = useSearch();");
    expect(auth).toContain("const query = new URLSearchParams(search);");
    expect(auth).not.toContain("window.location.search");
    expect(auth).toContain('href="/auth?mode=forgot"');
    expect(auth).toContain('href="/auth?mode=register"');
    expect(auth).toContain('href="/auth"');
  });

  it("gives auth inputs explicit id and name attributes", () => {
    expect(auth).toContain("id={name}");
    expect(auth).toContain("name={name}");
  });

  it("keeps the approved auth photography while public product pages use workflow visuals", () => {
    expect(auth).toContain("images.pexels.com/photos/8485714");
    expect(auth).not.toContain("images.pexels.com/photos/8837770");
  });
});
