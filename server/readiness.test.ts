import { describe, expect, it } from "vitest";
import { getProductionReadiness } from "./readiness";

const readyDependencies = {
  validateEnvironment: () => ({ valid: true, errors: [], warnings: [] }),
  checkDatabase: async () => ({ ready: true }),
  assetsExist: () => true,
  authReady: () => true,
  smtpReadiness: () => ({ ready: true, hostConfigured: true, portConfigured: true, userConfigured: true, passwordConfigured: true, fromConfigured: true }),
  genxReadiness: () => ({ ready: false }),
  genieReadiness: () => ({ configured: false, missing: [] }),
  outlookReadiness: () => ({ ready: false }),
};

describe("production readiness", () => {
  it("reports ready for valid environment, database, local auth, and local assets while optional integrations remain explicit", async () => {
    await expect(getProductionReadiness(readyDependencies)).resolves.toMatchObject({ status: "ready", database: "ready", auth: "ready", assets: "ready", genx: "not_configured", crmBridge: "not_configured", outlook: "not_configured" });
  });

  it("fails closed when the database check is unavailable", async () => {
    await expect(getProductionReadiness({ ...readyDependencies, checkDatabase: async () => ({ ready: false }) })).resolves.toMatchObject({ status: "not_ready", database: "unavailable" });
  });
});
