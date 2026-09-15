import { mkdtempSync, mkdirSync, readFileSync, readlinkSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("persistent Webdock release state", () => {
  it("binds a clean release tree to the canonical persistent state root", () => {
    const root = mkdtempSync(join(tmpdir(), "amarktai-state-"));
    const release = join(root, "release");
    const persistent = join(root, "persistent");
    mkdirSync(join(release, "deploy", "webdock"), { recursive: true });
    cpSync(
      new URL("../deploy/webdock/use-persistent-state.sh", import.meta.url),
      join(release, "deploy", "webdock", "use-persistent-state.sh")
    );

    const run = spawnSync(
      "sh",
      ["deploy/webdock/use-persistent-state.sh"],
      {
        cwd: release,
        env: { ...process.env, AMARKTAI_PERSISTENT_STATE_ROOT: persistent },
        encoding: "utf8",
      }
    );
    expect(run.status, run.stderr).toBe(0);
    for (const name of ["config", "files", "backups"]) {
      expect(resolve(release, "deploy", "webdock", readlinkSync(
        join(release, "deploy", "webdock", name)
      ))).toBe(resolve(persistent, name));
    }
  });

  it("aligns connector state ownership during updates before containers start", () => {
    const update = source("../deploy/webdock/update.sh");
    const backup = source("../deploy/webdock/backup.sh");
    const restore = source("../deploy/webdock/restore.sh");
    const align = source("../deploy/webdock/align-runtime-state.sh");

    expect(update).toContain("sh deploy/webdock/use-persistent-state.sh");
    expect(update).toContain("sh deploy/webdock/align-runtime-state.sh");
    expect(update.indexOf("align-runtime-state.sh")).toBeLessThan(
      update.indexOf("$COMPOSE up -d --remove-orphans")
    );
    expect(backup).toContain("$COMPOSE run --no-deps --rm -T --entrypoint sh app");
    expect(restore).toContain("sh deploy/webdock/use-persistent-state.sh");
    expect(restore).toContain("sh deploy/webdock/align-runtime-state.sh");
    expect(align).toContain("chown -R '$APP_RUNTIME_IDS' /app/data/connector-evidence");
    expect(align).toContain("chmod 700 /app/data/connector-evidence");
  });
});
