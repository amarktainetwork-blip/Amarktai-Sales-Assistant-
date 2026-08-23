import { afterEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit, rateLimit } from "./http";

function response() {
  const res = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn() } as any;
  res.status.mockReturnValue(res);
  return res;
}

const originalNodeEnv = process.env.NODE_ENV;
const originalRedisUrl = process.env.REDIS_URL;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = originalRedisUrl;
});

describe("shared security rate limiting", () => {
  it("fails closed for a production security-sensitive route when Valkey is not configured", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.REDIS_URL;
    const res = response();
    const next = vi.fn();
    await rateLimit({ limit: 2, windowMs: 60_000 })({ ip: "203.0.113.10", path: "/auth/login", baseUrl: "/api/auth", socket: {} } as any, res, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it("uses a bounded local fallback outside production when Valkey is not configured", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.REDIS_URL;
    const middleware = rateLimit({ limit: 1, windowMs: 60_000 });
    const request = { ip: "203.0.113.11", path: "/diagnostic", baseUrl: "/api/diagnostic", socket: {} } as any;
    const first = response(); const second = response();
    const next = vi.fn();
    await middleware(request, first, next);
    await middleware(request, second, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(second.status).toHaveBeenCalledWith(429);
  });

  it("makes the reusable public-auth limit fail closed in production and bounded in test mode", async () => {
    delete process.env.REDIS_URL;
    process.env.NODE_ENV = "production";
    await expect(checkRateLimit({ key: "test:public-auth:production", limit: 1, windowMs: 60_000, securitySensitive: true })).resolves.toBeNull();
    process.env.NODE_ENV = "test";
    await expect(checkRateLimit({ key: "test:public-auth:development", limit: 1, windowMs: 60_000, securitySensitive: true })).resolves.toMatchObject({ allowed: true });
    await expect(checkRateLimit({ key: "test:public-auth:development", limit: 1, windowMs: 60_000, securitySensitive: true })).resolves.toMatchObject({ allowed: false });
  });
});
