import fs from "node:fs";
import path from "node:path";
import { checkDatabaseReadiness } from "./db";
import { getGenieReadiness } from "./genie/config";
import { getGenxReadiness } from "./genx";
import { isLocalAuthMode } from "./localAuth";
import { validateProductionEnvironment } from "./productionConfig";
import { getSmtpReadiness } from "./smtp";
import { getOutlookReadiness } from "./outlook";

const CRITICAL_ASSETS = ["assets/hero-white-model.png", "assets/workflow-visual.png", "assets/coaching-visual.png", "assets/trust-visual.png", "assets/auth-security-visual.png"];

type ReadinessDependencies = {
  validateEnvironment?: typeof validateProductionEnvironment;
  checkDatabase?: typeof checkDatabaseReadiness;
  assetsExist?: () => boolean;
  authReady?: () => boolean;
  smtpReadiness?: typeof getSmtpReadiness;
  genxReadiness?: typeof getGenxReadiness;
  genieReadiness?: typeof getGenieReadiness;
  outlookReadiness?: typeof getOutlookReadiness;
};

function criticalAssetsExist() {
  const publicRoot = process.env.NODE_ENV === "production"
    ? path.resolve(import.meta.dirname, "public")
    : path.resolve(import.meta.dirname, "..", "client", "public");
  return CRITICAL_ASSETS.every(asset => fs.existsSync(path.join(publicRoot, asset)));
}

export async function getProductionReadiness(dependencies: ReadinessDependencies = {}) {
  const environment = (dependencies.validateEnvironment ?? validateProductionEnvironment)();
  const database = await (dependencies.checkDatabase ?? checkDatabaseReadiness)();
  const assetsReady = (dependencies.assetsExist ?? criticalAssetsExist)();
  const authReady = (dependencies.authReady ?? (() => isLocalAuthMode() && Boolean(process.env.LOCAL_ADMIN_EMAIL && process.env.LOCAL_ADMIN_PASSWORD)))();
  const smtp = (dependencies.smtpReadiness ?? getSmtpReadiness)();
  const genx = (dependencies.genxReadiness ?? getGenxReadiness)();
  const crmBridge = (dependencies.genieReadiness ?? getGenieReadiness)();
  const outlook = (dependencies.outlookReadiness ?? getOutlookReadiness)();
  const ready = environment.valid && database.ready && assetsReady && authReady;
  return {
    status: ready ? "ready" : "not_ready",
    environment: environment.valid ? "ready" : "invalid",
    database: database.ready ? "ready" : "unavailable",
    auth: authReady ? "ready" : "not_configured",
    assets: assetsReady ? "ready" : "missing",
    smtp: smtp.ready ? "configured" : "not_configured",
    genx: genx.ready ? "configured" : "not_configured",
    crmBridge: crmBridge.configured ? "configured" : "not_configured",
    outlook: outlook.ready ? "configured" : "not_configured",
    errors: environment.valid ? [] : environment.errors,
  };
}
