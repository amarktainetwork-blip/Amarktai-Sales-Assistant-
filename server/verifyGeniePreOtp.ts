import { spawnSync } from "node:child_process";
import {
  checkGeniePreOtpReadiness,
  consumeGeniePreOtpReadiness,
  createPreOtpHandoffProbe,
  verifyPreOtpHandoffProbe,
} from "./genie/preOtpReadiness";

function numberArgument(name: string) {
  const prefix = `--${name}=`;
  const raw = process.argv
    .find(value => value.startsWith(prefix))
    ?.slice(prefix.length);
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`A valid --${name}=<id> argument is required.`);
  return value;
}

function phaseArgument() {
  const raw =
    process.argv.find(value => value.startsWith("--phase="))?.slice(8) ||
    "full";
  if (!["create", "verify", "check", "consume", "full"].includes(raw))
    throw new Error("--phase must be create, verify, check, consume, or full.");
  return raw as "create" | "verify" | "check" | "consume" | "full";
}

const input = {
  userId: numberArgument("user-id"),
  organisationId: numberArgument("organisation-id"),
  connectedSystemId: numberArgument("connection-id"),
};

async function main() {
  const phase = phaseArgument();
  if (phase === "create") {
    await createPreOtpHandoffProbe(input);
    process.stdout.write("PRE_OTP_HANDOFF_CREATED=PASS\n");
    // Deliberately end only this CDP client. The remote browser, persistent
    // context, and sentinel page must remain alive for the verify process.
    process.exit(0);
  }
  if (phase === "verify") {
    const result = await verifyPreOtpHandoffProbe(input);
    if (!result.ready)
      throw new Error("PRE_OTP_READY verification did not pass every check.");
    process.stdout.write("PRE_OTP_HANDOFF_VERIFIED=PASS\nPRE_OTP_READY=PASS\n");
    process.exit(0);
  }
  if (phase === "check") {
    const result = await checkGeniePreOtpReadiness({
      ...input,
      managementElevationValid: true,
    });
    process.stdout.write(`PRE_OTP_RESULT=${JSON.stringify(result)}\n`);
    process.exit(0);
  }
  if (phase === "consume") {
    const result = await consumeGeniePreOtpReadiness({
      ...input,
      managementElevationValid: true,
    });
    process.stdout.write(
      `PRE_OTP_RESULT=${JSON.stringify(result)}\nPRE_OTP_CONSUMED=PASS\n`
    );
    process.exit(0);
  }

  const script = process.argv[1];
  const common = [
    `--user-id=${input.userId}`,
    `--organisation-id=${input.organisationId}`,
    `--connection-id=${input.connectedSystemId}`,
  ];
  for (const childPhase of ["create", "verify"] as const) {
    const child = spawnSync(
      process.execPath,
      [...process.execArgv, script, ...common, `--phase=${childPhase}`],
      {
        encoding: "utf8",
        timeout: 60_000,
        env: process.env,
      }
    );
    if (child.status !== 0)
      throw new Error(
        (
          child.stderr ||
          child.stdout ||
          `PRE_OTP_${childPhase.toUpperCase()}_FAILED`
        ).trim()
      );
  }
  const check = spawnSync(
    process.execPath,
    [...process.execArgv, script, ...common, "--phase=check"],
    {
      encoding: "utf8",
      timeout: 30_000,
      env: process.env,
    }
  );
  if (check.status !== 0)
    throw new Error(
      (check.stderr || check.stdout || "PRE_OTP_CHECK_FAILED").trim()
    );
  const resultLine = check.stdout
    .split(/\r?\n/)
    .find(line => line.startsWith("PRE_OTP_RESULT="));
  const readiness = resultLine
    ? (JSON.parse(resultLine.slice("PRE_OTP_RESULT=".length)) as {
        ready?: boolean;
        failure?: string;
      })
    : undefined;
  if (!readiness?.ready)
    throw new Error(
      `PRE_OTP_READY verification was not retained: ${readiness?.failure || "missing result"}`
    );
  process.stdout.write(`${resultLine}\nPRE_OTP_READY=PASS\n`);
}

main().catch(error => {
  process.stderr.write(
    `PRE_OTP_READY=FAIL\n${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
});
