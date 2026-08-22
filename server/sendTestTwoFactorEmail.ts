import { randomInt } from "node:crypto";
import { sendSecondFactorCode } from "./smtp";

const recipient = process.env.LOCAL_ADMIN_EMAIL;
if (!recipient) {
  console.error("LOCAL_ADMIN_EMAIL is required to send the explicit SMTP two-factor test message.");
  process.exitCode = 1;
} else {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  sendSecondFactorCode({ to: recipient, code })
    .then(() => console.log(`SMTP two-factor test message accepted for delivery to ${recipient}.`))
    .catch(error => {
      console.error("SMTP two-factor test message failed", error instanceof Error ? error.message : "unknown error");
      process.exitCode = 1;
    });
}
