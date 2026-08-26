import "dotenv/config";
import { resetAndDeleteGenieConnection } from "./genie/resetConnection";

function argument(name: string) {
  const prefix = `--${name}=`;
  const value = process.argv.find(item => item.startsWith(prefix));
  return value?.slice(prefix.length);
}

async function main() {
  const connectedSystemId = Number(argument("connection-id"));
  const organisationId = Number(argument("organisation-id"));
  const userId = Number(argument("user-id"));
  const confirmDelete = argument("confirm-delete") === String(connectedSystemId);
  const result = await resetAndDeleteGenieConnection({
    connectedSystemId,
    organisationId,
    userId,
    confirmDelete,
  });
  const output = [
    JSON.stringify({
      event: confirmDelete ? "genie_fresh_reset_complete" : "genie_fresh_reset_preview",
      ...result,
    }),
  ];
  if (!confirmDelete)
    output.push(
      `DRY_RUN_ONLY=YES Run again with --confirm-delete=${connectedSystemId} only after the preview identifies that exact Genie connection.`
    );
  process.stdout.write(`${output.join("\n")}\n`, () => process.exit(0));
}

main().catch(error => {
  console.error(
    JSON.stringify({
      event: "genie_fresh_reset_failed",
      detail: error instanceof Error ? error.message : String(error),
    })
  );
  process.exit(1);
});
