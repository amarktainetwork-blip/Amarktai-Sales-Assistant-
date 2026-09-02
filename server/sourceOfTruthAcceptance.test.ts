import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(process.cwd());
const read = (relative: string) =>
  readFileSync(path.join(root, relative), "utf8");

function filesBelow(relative: string): string[] {
  const directory = path.join(root, relative);
  return readdirSync(directory).flatMap(name => {
    const absolute = path.join(directory, name);
    return statSync(absolute).isDirectory()
      ? filesBelow(path.relative(root, absolute))
      : [path.relative(root, absolute).replaceAll("\\", "/")];
  });
}

describe("repository source of truth", () => {
  it("documents the canonical release and runtime boundary", () => {
    const readme = read("README.md");
    expect(readme).toContain(
      "https://github.com/amarktainetwork-blip/Amarktai-Sales-Assistant-.git"
    );
    expect(readme).toContain("/opt/amarktai-sales");
    expect(readme).toContain("deploy/webdock/docker-compose.yml");
    expect(readme).toContain("per-user delegated OAuth");
    expect(readme).toContain("Issue #89");
    expect(readme).not.toContain("OUTLOOK_SENDER_EMAIL");
    expect(readme).not.toContain("/api/outlook/inbound");

    const activeOperatorDocs = [
      read("docs/webdock-vps-install.md"),
      read("docs/genie-teach-amarktai.md"),
      read("docs/integration-research.md"),
      read("docs/implementation-status.md"),
    ].join("\n");
    expect(activeOperatorDocs).not.toContain(
      "encrypted per-connection username/password"
    );
    expect(activeOperatorDocs).not.toContain(
      "installation-time login configuration"
    );
    expect(activeOperatorDocs).not.toContain(
      "publicly reachable notification endpoint"
    );
  });

  it("returns one explicit unauthenticated truth to browser clients", () => {
    expect(read("server/routers.ts")).toContain(
      "me: publicProcedure.query(opts => opts.ctx.user ?? null)"
    );
  });

  it("exposes only delegated personal-mailbox deployment configuration", () => {
    const deployment = [
      read("deploy/webdock/configuration.template"),
      read("deploy/webdock/preflight.sh"),
    ].join("\n");
    for (const key of [
      "OUTLOOK_DELEGATED_TENANT_ID",
      "OUTLOOK_DELEGATED_CLIENT_ID",
      "OUTLOOK_DELEGATED_CLIENT_SECRET",
      "OUTLOOK_DELEGATED_REDIRECT_URI",
    ])
      expect(deployment).toContain(key);
    for (const legacy of [
      "OUTLOOK_TENANT_ID",
      "OUTLOOK_CLIENT_ID",
      "OUTLOOK_CLIENT_SECRET",
      "OUTLOOK_SENDER_EMAIL",
      "OUTLOOK_WEBHOOK_CLIENT_STATE",
      "OUTLOOK_INBOUND_ORGANISATION_ID",
      "OUTBOUND_EMAIL_PROVIDER",
    ])
      expect(deployment).not.toContain(legacy);
  });

  it("has one active personal-mailbox runtime and no legacy endpoint", () => {
    for (const obsolete of [
      "server/outlook.ts",
      "server/communications/outlookInboundQueue.ts",
      "server/communications/outlookInboundRoutes.ts",
    ])
      expect(existsSync(path.join(root, obsolete))).toBe(false);

    const runtime = filesBelow("server")
      .filter(file => /\.(ts|tsx)$/.test(file) && !file.endsWith(".test.ts"))
      .map(read)
      .join("\n");
    expect(runtime).not.toContain("/api/outlook/inbound");
    expect(runtime).not.toContain("createOutlookApplicationToken");
  });

  it("keeps exactly one public, dashboard and shared base stylesheet", () => {
    expect(
      filesBelow("client/src")
        .filter(file => file.endsWith(".css"))
        .sort()
    ).toEqual([
      "client/src/dashboard-final.css",
      "client/src/index.css",
      "client/src/marketing/final-site.css",
    ]);
  });
});
