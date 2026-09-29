import "dotenv/config";
import { resolve } from "node:path";
import { applyClientConfiguration } from "./applyClientConfiguration";

function positiveInteger(value: string | undefined, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${label}_INVALID`);
  return parsed;
}

async function main() {
  const [, , userRaw, organisationRaw, connectedSystemRaw, packRaw] =
    process.argv;
  const userId = positiveInteger(userRaw, "USER_ID");
  const organisationId = positiveInteger(organisationRaw, "ORGANISATION_ID");
  const connectedSystemId = positiveInteger(
    connectedSystemRaw,
    "CONNECTED_SYSTEM_ID"
  );
  if (!packRaw?.trim()) throw new Error("PACK_PATH_REQUIRED");
  const packPath = resolve(packRaw);

  const result = await applyClientConfiguration({
    userId,
    organisationId,
    connectedSystemId,
    packPath,
  });
  await new Promise<void>(resolve => {
    process.stdout.write(
      JSON.stringify({
        applied: true,
        organisationId,
        connectedSystemId,
        customerModel: result.customerModel,
        allowedWriteCapabilities: result.allowedWriteCapabilities,
      }) + "\n",
      () => resolve()
    );
  });
  process.exit(0);
}

main().catch(error => {
  const message = `${error instanceof Error ? error.message : String(error)}\n`;
  process.stderr.write(message, () => process.exit(1));
});
