import { access } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { getGenxReadiness } from "./genx";
import { isLocalAuthMode } from "./localAuth";
import { getSmtpReadiness } from "./smtp";
import { probeSttHealth } from "./voice/stt";
import { probeTtsHealth } from "./voice/tts";

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
  const [database, staticAssets, sttProbe, ttsProbe] = await Promise.all([
    databaseCheck(),
    staticAssetsCheck(),
    probeSttHealth("en"),
    probeTtsHealth(),
  ]);
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
      ok: sttProbe.ready,
      state: sttProbe.ready ? "READY" : "DORMANT",
      detail: sttProbe.ready
        ? undefined
        : `Live-call transcription is not currently warm: ${sttProbe.reason || "health probe failed"}.`,
      required: false,
    },
    tts: {
      ok: ttsProbe.ready,
      state: ttsProbe.ready ? "READY" : "DORMANT",
      detail: ttsProbe.ready
        ? undefined
        : `Speech synthesis is dormant until a voice feature needs it: ${ttsProbe.reason || "health probe failed"}.`,
      required: false,
    },
  };
  const ready = Object.values(checks)
    .filter(check => check.required !== false)
    .every(check => check.ok);
  return { status: ready ? "ready" as const : "not_ready" as const, service: "amarktai-sales", checks };
}
