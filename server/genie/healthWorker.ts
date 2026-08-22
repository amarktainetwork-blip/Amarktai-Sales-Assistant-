import "dotenv/config";
import { runGenieHealthCheck } from "./bridge";

const intervalMs = Number(process.env.CRM_HEALTH_INTERVAL_MS || 12 * 60 * 60 * 1000);

async function check() {
  const result = await runGenieHealthCheck();
  console.log(JSON.stringify({ event: "crm_connector_health", provider: "genie", ...result }));
}

void check();
setInterval(() => void check(), intervalMs).unref();

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
