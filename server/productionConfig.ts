type Env = NodeJS.ProcessEnv;

export type EnvironmentValidation = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

const PLACEHOLDER = /(^$|replace_with|example\.com|your-|changeme|placeholder|<[^>]+>)/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function required(env: Env, key: string, errors: string[]) {
  const value = env[key]?.trim() ?? "";
  if (!value || PLACEHOLDER.test(value)) errors.push(`${key} is missing or contains a placeholder.`);
  return value;
}

function requiredMailbox(env: Env, key: string, errors: string[]) {
  const value = env[key]?.trim() ?? "";
  const mailbox = value.match(/<([^>]+)>/)?.[1] ?? value;
  if (!value || PLACEHOLDER.test(mailbox)) errors.push(`${key} is missing or contains a placeholder.`);
  return value;
}

function strongSecret(env: Env, key: string, errors: string[], minimum = 32) {
  const value = required(env, key, errors);
  if (value && value.length < minimum) errors.push(`${key} must be at least ${minimum} characters.`);
  return value;
}

function validUrl(value: string, key: string, errors: string[]) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") errors.push(`${key} must use http or https.`);
  } catch {
    errors.push(`${key} must be a valid URL.`);
  }
}

export function validateProductionEnvironment(env: Env = process.env): EnvironmentValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (env.NODE_ENV !== "production") return { valid: true, errors, warnings: ["Development environment: production preflight is not enforced."] };

  const domain = required(env, "DOMAIN", errors);
  if (domain && (domain.includes("://") || domain.includes("/") || PLACEHOLDER.test(domain))) errors.push("DOMAIN must be a real hostname without a protocol or path.");
  const dbPassword = strongSecret(env, "DB_PASSWORD", errors);
  const dbRootPassword = strongSecret(env, "DB_ROOT_PASSWORD", errors);
  if (dbPassword && dbRootPassword && dbPassword === dbRootPassword) errors.push("DB_PASSWORD and DB_ROOT_PASSWORD must differ.");
  strongSecret(env, "JWT_SECRET", errors);
  strongSecret(env, "SECRET_KEY", errors);
  strongSecret(env, "BROWSERLESS_TOKEN", errors);
  strongSecret(env, "INTERNAL_SCHEDULER_TOKEN", errors);
  if (env.AUTH_MODE !== "local" || env.VITE_AUTH_MODE !== "local") errors.push("AUTH_MODE and VITE_AUTH_MODE must both be local for Webdock deployment.");
  const adminEmail = required(env, "LOCAL_ADMIN_EMAIL", errors);
  if (adminEmail && !EMAIL.test(adminEmail)) errors.push("LOCAL_ADMIN_EMAIL must be a valid email address.");
  strongSecret(env, "LOCAL_ADMIN_PASSWORD", errors, 16);
  required(env, "LOCAL_ADMIN_NAME", errors);

  const smtpHost = required(env, "SMTP_HOST", errors);
  const smtpPort = required(env, "SMTP_PORT", errors);
  if (smtpPort && (!/^\d+$/.test(smtpPort) || Number(smtpPort) < 1 || Number(smtpPort) > 65535)) errors.push("SMTP_PORT must be a valid TCP port.");
  required(env, "SMTP_USER", errors);
  required(env, "SMTP_PASSWORD", errors);
  const smtpFrom = requiredMailbox(env, "SMTP_FROM", errors);
  if (smtpFrom && !EMAIL.test(smtpFrom.match(/<([^>]+)>/)?.[1] ?? smtpFrom)) errors.push("SMTP_FROM must contain a valid sender email address.");
  if (smtpHost && /\s/.test(smtpHost)) errors.push("SMTP_HOST cannot contain whitespace.");

  const genxUrl = env.GENX_CHAT_COMPLETIONS_URL?.trim();
  const genxKey = env.GENX_API_KEY?.trim();
  const genxModel = env.GENX_DEFAULT_MODEL?.trim();
  if (genxUrl || genxKey || genxModel) {
    if (!genxUrl || !genxKey || !genxModel || PLACEHOLDER.test(genxUrl) || PLACEHOLDER.test(genxKey) || PLACEHOLDER.test(genxModel)) warnings.push("GenX is not fully configured and will remain Not Ready.");
    else validUrl(genxUrl, "GENX_CHAT_COMPLETIONS_URL", errors);
  } else warnings.push("GenX is not configured and will remain Not Ready.");

  const loginUrl = env.GENIE_LOGIN_URL?.trim();
  if (loginUrl) validUrl(loginUrl, "GENIE_LOGIN_URL", errors);
  else warnings.push("CRM browser bridge is not configured and will remain Not Ready.");
  return { valid: errors.length === 0, errors, warnings };
}
