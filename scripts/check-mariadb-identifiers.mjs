import fs from "node:fs";
import path from "node:path";

const migrationDir = path.resolve("drizzle");
const maxIdentifierLength = 64;
const failures = [];

for (const file of fs
  .readdirSync(migrationDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort()) {
  const sql = fs.readFileSync(path.join(migrationDir, file), "utf8");

  for (const match of sql.matchAll(/`([^`]+)`/g)) {
    const identifier = match[1];
    if (identifier.length > maxIdentifierLength) {
      failures.push({ file, identifier, length: identifier.length });
    }
  }
}

if (failures.length > 0) {
  console.error(
    `MariaDB identifier limit exceeded (${maxIdentifierLength} characters):`,
  );
  for (const failure of failures) {
    console.error(
      `${failure.file}: ${failure.length} characters: ${failure.identifier}`,
    );
  }
  process.exit(1);
}

console.log(
  `MariaDB identifier check passed: all migration identifiers are <= ${maxIdentifierLength} characters.`,
);
