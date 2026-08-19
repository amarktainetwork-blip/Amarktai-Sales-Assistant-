import type { NextFunction, Request, Response } from "express";

type RateState = { count: number; resetAt: number };
const windows = new Map<string, RateState>();
let lastCleanupAt = 0;

function clientKey(req: Request) {
  return `${req.ip || req.socket.remoteAddress || "unknown"}:${req.path}`;
}

function cleanupExpiredWindows(now: number) {
  if (now - lastCleanupAt < 60_000) return;
  lastCleanupAt = now;
  for (const [key, state] of windows) if (state.resetAt <= now) windows.delete(key);
}

export function rateLimit(options: { limit: number; windowMs: number }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    cleanupExpiredWindows(now);
    const key = clientKey(req);
    const current = windows.get(key);
    const state = !current || current.resetAt <= now ? { count: 0, resetAt: now + options.windowMs } : current;
    state.count += 1;
    windows.set(key, state);
    if (state.count > options.limit) {
      res.setHeader("Retry-After", Math.max(1, Math.ceil((state.resetAt - now) / 1000)));
      return res.status(429).json({ error: "Too many requests. Try again shortly." });
    }
    next();
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
