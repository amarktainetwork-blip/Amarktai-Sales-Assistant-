import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("final account presentation", () => {
  const auth = readFileSync(path.resolve(process.cwd(), "client/src/pages/Auth.tsx"), "utf8");

  it("uses account language instead of workspace creation language", () => {
    expect(auth).toContain("CREATE ACCOUNT");
    expect(auth).toContain("Create your Amarktai account.");
    expect(auth).toContain("Create account");
    expect(auth).not.toContain("CREATE WORKSPACE");
    expect(auth).not.toContain("Create your Sales Assistant workspace.");
  });

  it("gives auth inputs explicit id and name attributes", () => {
    expect(auth).toContain('id={id}');
    expect(auth).toContain('name={name}');
  });

  it("uses the approved replacement auth photography", () => {
    expect(auth).toContain("images.pexels.com/photos/7679563");
    expect(auth).not.toContain("images.pexels.com/photos/8837770");
  });
});
