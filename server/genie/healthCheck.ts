import "dotenv/config";
import { runGenieHealthCheck } from "./bridge";

async function main() {
  const result = await runGenieHealthCheck();
  console.log(JSON.stringify(result));
  process.exitCode = result.success ? 0 : 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
