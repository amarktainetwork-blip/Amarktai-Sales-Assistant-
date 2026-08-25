import "dotenv/config";
import { resetAndDeleteGenieConnection } from "./genie/resetConnection";

function argument(name: string) {
  const prefix = `--${name}=`;
  const value = process.argv.find(item => item.startsWith(prefix));
  return value?.slice(prefix.length);
}

async function main() {
  const connectedSystemId = Number(argument("connection-id"));
  const confirmDelete = process.argv.includes("--confirm-delete");
  const result = await resetAndDeleteGenieConnection({
    connectedSystemId,
    confirmDelete,
  });
  console.log(
    JSON.stringify({
      event: confirmDelete ? "genie_fresh_reset_complete" : "genie_fresh_reset_preview",
      ...result,
    })
  );
  if (!confirmDelete)
    console.log(
      "DRY_RUN_ONLY=YES Run again with --confirm-delete only after the preview identifies the exact Genie connection you intend to remove."
    );
}

main().catch(error => {
  console.error(
    JSON.stringify({
      event: "genie_fresh_reset_failed",
      detail: error instanceof Error ? error.message : String(error),
    })
  );
  process.exitCode = 1;
});
