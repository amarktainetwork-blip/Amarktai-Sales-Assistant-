import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const systems = readFileSync(
  new URL("./connectedSystems.ts", import.meta.url),
  "utf8"
);
const manager = readFileSync(
  new URL(
    "./browserConnectors/managedCrmBrowserSessionManager.ts",
    import.meta.url
  ),
  "utf8"
);

describe("connection-scoped CRM browser secret boundary", () => {
  it("keys active sessions by organisation, connected system and user, never provider", () => {
    expect(manager).toContain(
      "`${organisationId}:${connectedSystemId}:user:${userId}`"
    );
    expect(manager).not.toContain("`${provider}:");
  });

  it("loads the encrypted browser package by exact organisation, connection and kind", () => {
    const start = systems.indexOf("export async function loadConnectionSecret");
    const loader = systems.slice(
      start,
      systems.indexOf("export async function loadUserConnectionSecret", start)
    );
    expect(loader).toContain(
      "eq(connectedSystems.organisationId, input.organisationId)"
    );
    expect(loader).toContain(
      "eq(connectionSecrets.connectedSystemId, input.connectedSystemId)"
    );
    expect(loader).toContain(
      "eq(connectionSecrets.secretKind, input.secretKind)"
    );
  });

  it("uses a personal session package and a manager-only shared commissioning identity", () => {
    expect(manager).toContain('secretKind: "browser"');
    expect(manager).toContain("loadUserConnectionSecret");
    expect(manager).toContain("persistPersonalSession");
    expect(manager).toContain("if (!session.canCommission) return");
    expect(manager).toContain(
      "organisationId: session.connection.organisationId"
    );
    expect(manager).toContain("connectedSystemId: session.connection.id");
  });
});
