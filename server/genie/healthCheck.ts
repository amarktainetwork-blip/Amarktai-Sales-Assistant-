import "dotenv/config";
import { runGenieOperationWatchdog } from "./operationWatchdog";

async function main() {
  const result = await runGenieOperationWatchdog();
  console.log(JSON.stringify(result));
  process.exitCode = result.success ? 0 : 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
