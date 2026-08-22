import type { NextFunction, Request, Response } from "express";

type RateLimitRule = { limit: number; windowMs: number };
type RateLimitRecord = { count: number; resetAt: number };

const RATE_LIMITS: Record<string, RateLimitRule> = {
  "auth.localLogin": { limit: 5, windowMs: 15 * 60_000 },
  "security.requestEmailCode": { limit: 3, windowMs: 10 * 60_000 },
  "security.verifyEmailCode": { limit: 8, windowMs: 10 * 60_000 },
  "companySetup.discoverWebsite": { limit: 6, windowMs: 10 * 60_000 },
  "companySetup.confirmDiscovery": { limit: 6, windowMs: 10 * 60_000 },
  "companySetup.verifyCrm": { limit: 6, windowMs: 60 * 60_000 },
  "assistant.chat": { limit: 30, windowMs: 60_000 },
  "communications.prepareHumanEmail": { limit: 20, windowMs: 60_000 },
  "calls.coachTranscript": { limit: 30, windowMs: 60_000 },
  "calls.completeLive": { limit: 12, windowMs: 10 * 60_000 },
  "assistant.executeApprovedGenieAction": { limit: 8, windowMs: 10 * 60_000 },
};

const records = new Map<string, RateLimitRecord>();

function procedureNames(req: Request) {
  return decodeURIComponent(req.path.replace(/^\//, ""))
    .split(",")
    .map(name => name.trim())
    .filter(Boolean);
}

function clientKey(req: Request) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function reject(res: Response, status: number, message: string) {
  res.status(status).json({ error: { message } });
}

export function requireSameOriginForStateChanges(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS" || process.env.NODE_ENV !== "production") return next();
  const origin = req.get("origin");
  const host = req.get("host");
  if (!origin || !host) return reject(res, 403, "Same-origin verification is required for state-changing requests.");
  try {
    const parsed = new URL(origin);
    if (parsed.host !== host || parsed.protocol !== "https:") return reject(res, 403, "Cross-origin state-changing requests are not allowed.");
  } catch {
    return reject(res, 403, "Cross-origin state-changing requests are not allowed.");
  }
  return next();
}

export function limitSensitiveProcedures(req: Request, res: Response, next: NextFunction) {
  const names = procedureNames(req);
  const matchedRule = names.map(name => ({ name, rule: RATE_LIMITS[name] })).find((item): item is { name: string; rule: RateLimitRule } => Boolean(item.rule));
  if (!matchedRule) return next();

  const now = Date.now();
  const key = `${matchedRule.name}:${clientKey(req)}`;
  const existing = records.get(key);
  if (!existing || existing.resetAt <= now) {
    records.set(key, { count: 1, resetAt: now + matchedRule.rule.windowMs });
    return next();
  }
  if (existing.count >= matchedRule.rule.limit) {
    res.setHeader("Retry-After", Math.ceil((existing.resetAt - now) / 1000));
    return reject(res, 429, "Too many requests. Please wait before trying again.");
  }
  existing.count += 1;
  return next();
}

export function resetRateLimitsForTests() {
  records.clear();
}
