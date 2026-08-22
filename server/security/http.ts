import type { NextFunction, Request, Response } from "express";
import { createClient } from "redis";

type RateState = { count: number; resetAt: number };
const windows = new Map<string, RateState>();
let lastCleanupAt = 0;
let redisClient: any = null;
let redisConnectPromise: Promise<any | null> | null = null;

function clientKey(req: Request) {
  return `${req.ip || req.socket.remoteAddress || "unknown"}:${req.path}`;
}

function cleanupExpiredWindows(now: number) {
  if (now - lastCleanupAt < 60_000) return;
  lastCleanupAt = now;
  windows.forEach((state, key) => {
    if (state.resetAt <= now) windows.delete(key);
  });
}

function incrementLocalWindow(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  cleanupExpiredWindows(now);
  const current = windows.get(key);
  const state = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
  state.count += 1;
  windows.set(key, state);
  return { allowed: state.count <= limit, retryAfterSeconds: Math.max(1, Math.ceil((state.resetAt - now) / 1000)) };
}

async function sharedRateLimit(key: string, limit: number, windowMs: number) {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!redisClient?.isOpen) {
    if (!redisConnectPromise) {
      redisConnectPromise = (async () => {
        const client = createClient({ url, socket: { reconnectStrategy: retries => Math.min(1_000, retries * 100) } });
        client.on("error", error => console.warn(JSON.stringify({ event: "rate_limit_valkey_error", detail: error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160) })));
        await client.connect();
        redisClient = client;
        return client;
      })().catch(error => {
        console.warn(JSON.stringify({ event: "rate_limit_valkey_unavailable", detail: error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160) }));
        redisConnectPromise = null;
        return null;
      });
    }
    const connected = await redisConnectPromise;
    if (!connected) return null;
  }
  const client = redisClient;
  if (!client) return null;
  const result = await client.eval(
    "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); end; local ttl = redis.call('PTTL', KEYS[1]); return {count, ttl};",
    { keys: [key], arguments: [String(windowMs)] },
  ) as [number, number];
  return { allowed: result[0] <= limit, retryAfterSeconds: Math.max(1, Math.ceil(result[1] / 1000)) };
}

export async function checkRateLimit(input: { key: string; limit: number; windowMs: number; securitySensitive?: boolean }) {
  try {
    const shared = await sharedRateLimit(input.key, input.limit, input.windowMs);
    return shared ?? (process.env.NODE_ENV === "production" && input.securitySensitive !== false ? null : incrementLocalWindow(input.key, input.limit, input.windowMs));
  } catch (error) {
    console.warn(JSON.stringify({ event: "rate_limit_error", detail: error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160) }));
    if (process.env.NODE_ENV === "production" && input.securitySensitive !== false) return null;
    return incrementLocalWindow(input.key, input.limit, input.windowMs);
  }
}

export function rateLimit(options: { limit: number; windowMs: number; securitySensitive?: boolean }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = `amarktai:rate-limit:${req.baseUrl || req.path}:${clientKey(req)}`;
    const result = await checkRateLimit({ key, ...options });
    if (!result) return res.status(503).json({ error: "Security rate limiter is temporarily unavailable. Try again shortly." });
    if (!result.allowed) {
      res.setHeader("Retry-After", result.retryAfterSeconds);
      return res.status(429).json({ error: "Too many requests. Try again shortly." });
    }
    return next();
  };
}

/** Applies safe defaults without a runtime dependency on security middleware. */
export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  // wss: is required by optional realtime media/STT services. Microphone access is limited
  // to this origin; recording/transcription still remains organisation-policy controlled.
  res.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https: wss:; media-src 'self' blob: data:; font-src 'self' data:; upgrade-insecure-requests");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(self), geolocation=(), payment=()");
  if (req.secure || req.header("x-forwarded-proto")?.split(",").some(value => value.trim() === "https")) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}

/** Reject browser origins other than the public app origin. No origin is valid for same-site navigation and server jobs. */
export function enforceAppOrigin(req: Request, res: Response, next: NextFunction) {
  const origin = req.header("origin");
  const configured = process.env.APP_PUBLIC_URL?.replace(/\/$/, "");
  if (!origin || !configured || origin === configured) return next();
  return res.status(403).json({ error: "This request origin is not allowed." });
}

export function allowSidecarOrigin(req: Request, res: Response, next: NextFunction) {
  const origin = req.header("origin");
  if (origin?.startsWith("chrome-extension://")) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
}
