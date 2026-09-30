import { access } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { getGenxReadiness } from "./genx";
import { isLocalAuthMode } from "./localAuth";
import { getSmtpReadiness } from "./smtp";
import { getSttConfiguration } from "./voice/stt";
import { getTtsConfiguration } from "./voice/tts";

export type ReadinessCheck = {
  ok: boolean;
  state: string;
  detail?: string;
  required?: boolean;
};

function configuredSecret(name: string, minimumLength: number) {
  const value = process.env[name]?.trim() || "";
  return value.length >= minimumLength;
}

async function databaseCheck(): Promise<ReadinessCheck> {
  try {
    const db = await getDb();
    if (!db) return { ok: false, state: "UNAVAILABLE", detail: "Database client is unavailable." };
    await db.execute(sql`SELECT 1`);
    return { ok: true, state: "READY" };
  } catch {
    return { ok: false, state: "UNAVAILABLE", detail: "Database query failed." };
  }
}

async function staticAssetsCheck(): Promise<ReadinessCheck> {
  try {
    const publicDir = process.env.NODE_ENV === "production" ? path.resolve(process.cwd(), "dist/public") : path.resolve(process.cwd(), "client");
    await access(path.join(publicDir, "index.html"));
    return { ok: true, state: "READY" };
  } catch {
    return { ok: false, state: "MISSING", detail: "Production web assets are unavailable." };
  }
}

export async function getProductionReadiness() {
  const [database, staticAssets] = await Promise.all([
    databaseCheck(),
    staticAssetsCheck(),
  ]);
  const stt = getSttConfiguration();
  const tts = getTtsConfiguration();
  const smtp = getSmtpReadiness();
  const genx = getGenxReadiness();
  const authOk = isLocalAuthMode() && configuredSecret("JWT_SECRET", 32) && configuredSecret("SECRET_KEY", 32);
  const checks: Record<string, ReadinessCheck> = {
    database,
    staticAssets,
    auth: { ok: authOk, state: authOk ? "READY" : "INVALID_CONFIGURATION", detail: authOk ? undefined : "Production requires local auth plus 32+ character JWT_SECRET and SECRET_KEY." },
    smtp: { ok: smtp.ready, state: smtp.ready ? "CONFIGURED_UNVERIFIED" : "NOT_CONFIGURED", detail: smtp.ready ? "Run the production integration verifier to prove the SMTP transport." : "SMTP is mandatory for 2FA, invitations and recovery." },
    genx: { ok: genx.configured, state: genx.configured ? "CONFIGURED_UNVERIFIED" : "NOT_CONFIGURED", detail: genx.configured ? "Run the production integration verifier to prove the model catalogue and inference path." : "GenX endpoint, key and default model are required." },
    stt: {
      ok: stt.configured || stt.fastEnglishConfigured,
      state: stt.fastEnglishConfigured ? "CONFIGURED_WARM_LANE" : stt.configured ? "CONFIGURED_DORMANT" : "NOT_CONFIGURED",
      detail:
        "Voice runtime health is checked only by the Calls/Voice readiness endpoints so core platform readiness never waits on an optional voice service.",
      required: false,
    },
    tts: {
      ok: tts.configured,
      state: tts.configured ? "CONFIGURED_DORMANT" : "NOT_CONFIGURED",
      detail:
        "Speech synthesis is optional for core platform readiness and is probed only when a voice feature is used.",
      required: false,
    },
  };
  const ready = Object.values(checks)
    .filter(check => check.required !== false)
    .every(check => check.ok);
  return { status: ready ? "ready" as const : "not_ready" as const, service: "amarktai-sales", checks };
}
