import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createTransport: vi.fn(), verify: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: mocks.createTransport } }));

import { getSmtpReadiness, verifySmtpTransport } from "./smtp";

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createTransport.mockReturnValue({ verify: mocks.verify });
});

describe("SMTP readiness", () => {
  it("reports an incomplete transport as not configured without opening a network connection", async () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    delete process.env.SMTP_FROM;

    expect(getSmtpReadiness().ready).toBe(false);
    await expect(verifySmtpTransport()).resolves.toEqual({ ready: false, reason: "not_configured" });
  });

  it("reports a configured but unreachable transport without leaking the provider error", async () => {
    Object.assign(process.env, { SMTP_HOST: "smtp.example.co.za", SMTP_PORT: "587", SMTP_USER: "user", SMTP_PASSWORD: "password", SMTP_FROM: "Amarktai <admin@example.co.za>" });
    mocks.verify.mockRejectedValue(new Error("socket timeout with private provider detail"));

    await expect(verifySmtpTransport()).resolves.toEqual({ ready: false, reason: "verification_failed" });
    expect(mocks.createTransport).toHaveBeenCalledOnce();
  });
});
