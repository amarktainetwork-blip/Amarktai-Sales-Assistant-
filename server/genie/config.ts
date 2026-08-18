export const GENIE_REQUIRED_ENV = [
  "GENIE_LOGIN_URL",
  "GENIE_USERNAME",
  "GENIE_PASSWORD",
  "BROWSERLESS_WS_ENDPOINT",
] as const;

export type GenieReadiness = {
  configured: boolean;
  missing: string[];
  mode: "browser_automation";
};

export function getGenieReadiness(): GenieReadiness {
  const missing = GENIE_REQUIRED_ENV.filter(key => !process.env[key]);
  return { configured: missing.length === 0, missing, mode: "browser_automation" };
}

export function requireGenieConfig() {
  const readiness = getGenieReadiness();
  if (!readiness.configured) {
    throw new Error(`Genie browser automation is not configured. Missing: ${readiness.missing.join(", ")}.`);
  }
  return {
    loginUrl: process.env.GENIE_LOGIN_URL!,
    username: process.env.GENIE_USERNAME!,
    password: process.env.GENIE_PASSWORD!,
    browserEndpoint: process.env.BROWSERLESS_WS_ENDPOINT!,
    usernameSelector: process.env.GENIE_USERNAME_SELECTOR || 'input[name="username"]',
    passwordSelector: process.env.GENIE_PASSWORD_SELECTOR || 'input[type="password"]',
    submitSelector: process.env.GENIE_LOGIN_SUBMIT_SELECTOR || 'button[type="submit"]',
    dashboardSelector: process.env.GENIE_DASHBOARD_SELECTOR || "body",
  };
}
