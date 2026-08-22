import { afterEach, describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import { limitSensitiveProcedures, requireSameOriginForStateChanges, resetRateLimitsForTests } from "./security";

const originalNodeEnv = process.env.NODE_ENV;

function request(input: { method?: string; path: string; origin?: string; host?: string; ip?: string }) {
  return {
    method: input.method ?? "POST",
    path: input.path,
    ip: input.ip ?? "203.0.113.25",
    socket: { remoteAddress: input.ip ?? "203.0.113.25" },
    get(name: string) {
      if (name === "origin") return input.origin;
      if (name === "host") return input.host;
      return undefined;
    },
  } as unknown as Request;
}

function response() {
  const result = { statusCode: 200, body: undefined as unknown, retryAfter: undefined as unknown };
  const res = {
    status(code: number) { result.statusCode = code; return this; },
    json(body: unknown) { result.body = body; return this; },
    setHeader(name: string, value: unknown) { if (name === "Retry-After") result.retryAfter = value; },
  } as unknown as Response;
  return { res, result };
}

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  resetRateLimitsForTests();
});

describe("state-change origin protection", () => {
  it("rejects a production POST without a same-origin HTTPS Origin header", () => {
    process.env.NODE_ENV = "production";
    const { res, result } = response();
    let nextCalled = false;
    requireSameOriginForStateChanges(request({ path: "/auth.localLogin", host: "sales.example.co.za", origin: "https://attacker.example" }), res, () => { nextCalled = true; });

    expect(nextCalled).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  it("allows an HTTPS same-origin production state change", () => {
    process.env.NODE_ENV = "production";
    const { res } = response();
    let nextCalled = false;
    requireSameOriginForStateChanges(request({ path: "/auth.localLogin", host: "sales.example.co.za", origin: "https://sales.example.co.za" }), res, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
  });
});

describe("sensitive procedure rate limiting", () => {
  it("limits local login attempts by client and procedure", () => {
    const req = request({ path: "/auth.localLogin" });
    for (let index = 0; index < 5; index += 1) {
      const { res, result } = response();
      let nextCalled = false;
      limitSensitiveProcedures(req, res, () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
      expect(result.statusCode).toBe(200);
    }
    const { res, result } = response();
    limitSensitiveProcedures(req, res, () => {});
    expect(result.statusCode).toBe(429);
    expect(result.retryAfter).toBeTypeOf("number");
  });

  it("uses distinct buckets for distinct sensitive procedures", () => {
    for (let index = 0; index < 5; index += 1) limitSensitiveProcedures(request({ path: "/auth.localLogin" }), response().res, () => {});
    const { res } = response();
    let nextCalled = false;
    limitSensitiveProcedures(request({ path: "/assistant.chat" }), res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });
});
