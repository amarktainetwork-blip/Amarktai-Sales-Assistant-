import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync(
  new URL("../deploy/webdock/backup.sh", import.meta.url),
  "utf8"
);

describe("production backup retention", () => {
  it("keeps three complete standard sets by default with explicit override", () => {
    expect(script).toContain('KEEP_STANDARD_BACKUPS="${AMARKTAI_BACKUP_KEEP_STANDARD:-3}"');
    for (const suffix of [
      ".sql.gz",
      ".sql.gz.sha256",
      "-connector-files.tar.gz",
      "-connector-files.tar.gz.sha256",
      ".manifest.txt",
    ]) expect(script).toContain('amarktai-${old_stamp}' + suffix);
  });
});
