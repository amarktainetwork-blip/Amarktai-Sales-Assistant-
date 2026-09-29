import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dockerfile = readFileSync("deploy/webdock/Dockerfile", "utf8");
const compose = readFileSync("deploy/webdock/docker-compose.yml", "utf8");

describe("runtime client-pack packaging", () => {
  it("copies immutable client packs outside the production /app/config bind mount", () => {
    expect(compose).toContain("./config:/app/config:ro");
    expect(dockerfile).toContain("/app/config/client-packs ./client-packs");
  });
});
