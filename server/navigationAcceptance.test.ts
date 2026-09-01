import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

function files(root: string): string[] {
  return readdirSync(root).flatMap(name => {
    const target = path.join(root, name);
    return statSync(target).isDirectory()
      ? files(target)
      : target.endsWith(".tsx")
        ? [target]
        : [];
  });
}

describe("client navigation acceptance", () => {
  it("keeps every literal internal navigation target on a real route", () => {
    const clientRoot = path.resolve(process.cwd(), "client/src");
    const app = readFileSync(path.join(clientRoot, "App.tsx"), "utf8");
    const routes = new Set(
      Array.from(app.matchAll(/<Route\s+path="([^"]+)"/g), match => match[1])
    );
    const references = new Set<string>();
    for (const file of files(clientRoot)) {
      if (file.endsWith("ComponentShowcase.tsx")) continue;
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(
        /(?:href=|navigate\(|setLocation\(|window\.location\.assign\()\s*["'`]([^"'`]+)["'`]/g
      )) {
        const target = match[1].split(/[?#]/)[0];
        if (
          target.startsWith("/") &&
          !target.startsWith("/api/") &&
          !target.includes("${")
        )
          references.add(target);
      }
    }
    expect(
      Array.from(references).filter(target => !routes.has(target))
    ).toEqual([]);
  });
});
