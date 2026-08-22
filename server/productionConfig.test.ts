import { afterEach, describe, expect, it } from "vitest";
import { validateProductionEnvironment } from "./productionConfig";

const originalEnvironment = { ...process.env };
const secret = (value: string) => value.repeat(8);

function productionEnvironment(overrides: NodeJS.ProcessEnv = {}) {
  return {
    NODE_ENV: "production",
    DOMAIN: "assistant.example.co.za",
    DB_PASSWORD: secret("database"),
    DB_ROOT_PASSWORD: secret("root-password"),
    JWT_SECRET: secret("jwt-secret"),
    SECRET_KEY: secret("app-secret"),
    BROWSERLESS_TOKEN: secret("browser-token"),
    INTERNAL_SCHEDULER_TOKEN: secret("scheduler-token"),
    AUTH_MODE: "local",
    VITE_AUTH_MODE: "local",
    LOCAL_ADMIN_NAME: "Amarktai Administrator",
    LOCAL_ADMIN_EMAIL: "admin@example.co.za",
    LOCAL_ADMIN_PASSWORD: secret("admin-password"),
    SMTP_HOST: "smtp.example.co.za",
    SMTP_PORT: "587",
    SMTP_USER: "smtp-user",
    SMTP_PASSWORD: secret("smtp-password"),
    SMTP_FROM: "Amarktai Sales Assistant <admin@example.co.za>",
    ...overrides,
  };
}

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe("production environment validation", () => {
  it("accepts the mandatory self-hosted configuration while describing unconfigured optional integrations as warnings", () => {
    const result = validateProductionEnvironment(productionEnvironment());

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual(expect.arrayContaining(["GenX is not configured and will remain Not Ready.", "CRM browser bridge is not configured and will remain Not Ready."]));
  });

  it("rejects placeholder secrets, a non-local authentication mode, and an invalid SMTP sender", () => {
    const result = validateProductionEnvironment(productionEnvironment({ JWT_SECRET: "replace_with_jwt_secret", AUTH_MODE: "oauth", SMTP_FROM: "not-an-email" }));

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining(["JWT_SECRET is missing or contains a placeholder.", "AUTH_MODE and VITE_AUTH_MODE must both be local for Webdock deployment.", "SMTP_FROM must contain a valid sender email address."]));
  });

  it("requires all optional GenX values once any GenX setting is declared", () => {
    const result = validateProductionEnvironment(productionEnvironment({ GENX_CHAT_COMPLETIONS_URL: "https://query.example.test/v1/chat/completions" }));

    expect(result.warnings).toContain("GenX is not fully configured and will remain Not Ready.");
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});
