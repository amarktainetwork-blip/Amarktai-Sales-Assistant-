import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("dist/public");
const secretNames = [
  "GENX_API_KEY", "SMTP_PASSWORD", "CONNECTION_SECRETS_MASTER_KEY", "DB_PASSWORD", "DB_ROOT_PASSWORD",
  "OUTLOOK_CLIENT_SECRET", "HUBSPOT_CLIENT_SECRET", "SALESFORCE_CLIENT_SECRET", "PIPEDRIVE_CLIENT_SECRET",
  "ZOHO_CLIENT_SECRET", "GENIE_PASSWORD", "WHATSAPP_WEBHOOK_TOKEN", "SMS_WEBHOOK_TOKEN",
];
const files = [];
async function walk(directory) {
  for (const name of await readdir(directory)) {
    const target = path.join(directory, name);
    if ((await stat(target)).isDirectory()) await walk(target); else files.push(target);
  }
}
await walk(root);
const forbiddenValues = secretNames.map(name => process.env[name]).filter(value => value && value.length >= 8 && !/replace_|example|placeholder/i.test(value));
for (const file of files) {
  const content = await readFile(file, "utf8").catch(() => "");
  const nameHit = secretNames.find(name => content.includes(name));
  const valueHit = forbiddenValues.find(value => content.includes(value));
  if (nameHit || valueHit) {
    console.error(`Frontend secret scan failed in ${path.relative(root, file)} (${nameHit ? `server variable ${nameHit}` : "configured secret value"}).`);
    process.exit(1);
  }
}
console.log(`Frontend secret scan passed for ${files.length} production bundle files.`);
