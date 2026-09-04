import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("final account presentation", () => {
  const auth = readFileSync(
    path.resolve(process.cwd(), "client/src/pages/Auth.tsx"),
    "utf8"
  );
  const app = readFileSync(
    path.resolve(process.cwd(), "client/src/App.tsx"),
    "utf8"
  );

  it("uses account language and the canonical AmarktAI spelling", () => {
    expect(auth).toContain("CREATE ACCOUNT");
    expect(auth).toContain("Create your AmarktAI account.");
    expect(auth).toContain("Create account");
    expect(auth).not.toContain("Create your Amarktai account.");
    expect(auth).not.toContain("CREATE WORKSPACE");
    expect(auth).not.toContain("Create your Sales Assistant workspace.");
    expect(app).toContain("Secure Access | AmarktAI Network Sales Assistant");
    expect(app).toContain("AmarktAI Network Sales Assistant");
    expect(app).not.toContain("Amarktai Network Sales Assistant");
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

  it("keeps identity proof inside secure access and uses first-party visuals", () => {
    expect(auth).toContain('/auth?step=verify');
    expect(auth).toContain("Verify your email.");
    expect(auth).toContain('/images/site-hero.svg');
    expect(auth).not.toContain("images.pexels.com");
    expect(auth).not.toContain("images.unsplash.com");
    expect(auth).not.toContain('navigate("/dashboard")');
  });
});
