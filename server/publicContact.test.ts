import { afterEach, describe, expect, it, vi } from "vitest";
import {
  contactPayloadSchema,
  contactRateLimit,
  createContactHandler,
} from "./publicContact";
import { rateLimit } from "./security/http";

const originalRecipient = process.env.CONTACT_RECIPIENT_EMAIL;
const originalAdmin = process.env.LOCAL_ADMIN_EMAIL;
const originalNodeEnv = process.env.NODE_ENV;
const originalRedis = process.env.REDIS_URL;

afterEach(() => {
  if (originalRecipient === undefined)
    delete process.env.CONTACT_RECIPIENT_EMAIL;
  else process.env.CONTACT_RECIPIENT_EMAIL = originalRecipient;
  if (originalAdmin === undefined) delete process.env.LOCAL_ADMIN_EMAIL;
  else process.env.LOCAL_ADMIN_EMAIL = originalAdmin;
  if (originalRedis === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = originalRedis;
  process.env.NODE_ENV = originalNodeEnv;
  vi.restoreAllMocks();
});

const validPayload = {
  name: "Thandi Mokoena",
  email: "thandi@example.com",
  company: "North Star Sales",
  phone: "",
  teamSize: "8",
  reason: "Team setup",
  message:
    "We would like to discuss a guided team setup and CRM compatibility.",
  website: "",
};

function response() {
  const res = { status: vi.fn(), json: vi.fn(), setHeader: vi.fn() } as any;
  res.status.mockReturnValue(res);
  return res;
}

describe("public contact form backend", () => {
  it("accepts a valid bounded plain-text payload", () => {
    expect(contactPayloadSchema.safeParse(validPayload).success).toBe(true);
    expect(
      contactPayloadSchema.safeParse({
        ...validPayload,
        message: "<script>alert(1)</script> enough text",
      }).success
    ).toBe(false);
    expect(
      contactPayloadSchema.safeParse({ ...validPayload, extra: "not accepted" })
        .success
    ).toBe(false);
  });

  it("sends a formatted enquiry to the configured recipient", async () => {
    process.env.CONTACT_RECIPIENT_EMAIL = "contact@amarktai.example";
    const mailer = vi.fn().mockResolvedValue(undefined);
    const res = response();
    await createContactHandler(mailer as any)(
      { body: validPayload } as any,
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mailer).toHaveBeenCalledOnce();
    expect(mailer.mock.calls[0][0]).toMatchObject({
      to: "contact@amarktai.example",
      subject: "Amarktai website enquiry — Team setup",
    });
    expect(mailer.mock.calls[0][0].html).toContain("North Star Sales");
  });

  it.each([" user@example.com ", "USER@example.com"])(
    "trims a valid email before validation and delivery: %s",
    async email => {
      process.env.CONTACT_RECIPIENT_EMAIL = "contact@amarktai.example";
      const mailer = vi.fn().mockResolvedValue(undefined);
      const res = response();
      await createContactHandler(mailer as any)(
        { body: { ...validPayload, email } } as any,
        res
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(mailer).toHaveBeenCalledOnce();
      expect(mailer.mock.calls[0][0].text).toContain(`Email: ${email.trim()}`);
    }
  );

  it("returns a visible-safe failure when SMTP delivery fails", async () => {
    process.env.CONTACT_RECIPIENT_EMAIL = "contact@amarktai.example";
    const res = response();
    await createContactHandler(
      vi.fn().mockRejectedValue(new Error("SMTP unavailable")) as any
    )({ body: validPayload } as any, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      error: "We couldn't send your message. Please try again.",
    });
  });

  it("rejects invalid payloads before attempting delivery", async () => {
    process.env.LOCAL_ADMIN_EMAIL = "admin@amarktai.example";
    const mailer = vi.fn();
    const res = response();
    await createContactHandler(mailer as any)(
      { body: { ...validPayload, email: "invalid" } } as any,
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mailer).not.toHaveBeenCalled();
  });

  it("drops honeypot abuse without sending mail or revealing the filter", async () => {
    process.env.LOCAL_ADMIN_EMAIL = "admin@amarktai.example";
    const mailer = vi.fn();
    const res = response();
    await createContactHandler(mailer as any)(
      { body: { ...validPayload, website: "https://spam.example" } } as any,
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mailer).not.toHaveBeenCalled();
  });

  it("applies the bounded public contact rate limit", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.REDIS_URL;
    const middleware = rateLimit(contactRateLimit);
    const request = {
      ip: "203.0.113.94",
      path: "/contact",
      baseUrl: "/api/public/contact",
      socket: {},
    } as any;
    const next = vi.fn();
    for (let count = 0; count < contactRateLimit.limit; count++)
      await middleware(request, response(), next);
    const blocked = response();
    await middleware(request, blocked, next);
    expect(next).toHaveBeenCalledTimes(contactRateLimit.limit);
    expect(blocked.status).toHaveBeenCalledWith(429);
  });
});
