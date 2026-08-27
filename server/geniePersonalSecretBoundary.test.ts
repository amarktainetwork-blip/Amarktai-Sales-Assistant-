import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = await readFile(
  new URL("./connectedSystems.ts", import.meta.url),
  "utf8"
);

describe("Genie personal browser secret boundary", () => {
  it("writes manager-driven Genie browser credentials into the acting user's personal namespace", () => {
    expect(source).toContain('system.provider === "genie" && input.secretKind === "browser"');
    expect(source).toContain("personalSecretKind(input.userId, input.secretKind)");
  });

  it("never falls back to a legacy shared browser secret for Genie", () => {
    const genieBranch = source.slice(
      source.indexOf('if (system.provider === "genie" && input.secretKind === "browser")'),
      source.indexOf("const rows = await db", source.indexOf('if (system.provider === "genie" && input.secretKind === "browser")'))
    );
    expect(genieBranch).toContain('like(connectionSecrets.secretKind, "browser:user:%")');
    expect(genieBranch).not.toContain('eq(connectionSecrets.secretKind, input.secretKind)');
  });

  it("fails closed when more than one personal Genie browser session exists", () => {
    expect(source).toContain("GENIE_PERSONAL_SECRET_AMBIGUOUS");
    expect(source).toContain(".limit(2)");
  });

  it("loads an explicitly requested user's secret by exact personal key", () => {
    const start = source.indexOf("export async function loadUserConnectionSecret");
    const end = source.indexOf("export async function hasUserConnectionSecret", start);
    const userLoader = source.slice(start, end);
    expect(userLoader).toContain("personalSecretKind(input.userId, input.secretKind)");
    expect(userLoader).not.toContain("return loadConnectionSecret");
  });
});
