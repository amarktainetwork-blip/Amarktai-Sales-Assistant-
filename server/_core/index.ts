import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { registerCrmOAuthRoutes } from "../crm/oauthRoutes";
import { startAutomaticCommissioningWorker } from "../crm/automaticCommissioning";
import { registerSidecarRoutes } from "../sidecar/routes";
import { registerLiveCallRoutes } from "../liveCalls/routes";
import { registerTeamAdminRoutes } from "../teamAdmin/routes";
import { registerManagementSettingsRoutes } from "../managementSettingsRoutes";
import { registerConnectedSystemAdminRoutes } from "../connectedSystemAdminRoutes";
import { registerSalesAutomationRoutes } from "../salesAutomationRoutes";
import { registerSalesTargetsRoutes } from "../salesTargetsRoutes";
import { registerAiCreditsRoutes } from "../aiCreditsRoutes";
import { registerCompanyIntelligenceRoutes } from "../companyIntelligenceRoutes";
import { registerConnectorWebhookRoutes } from "../connectors/webhookRoutes";
import { registerOutlookInboundRoutes } from "../communications/outlookInboundRoutes";
import { registerVoiceRoutes } from "../voice/routes";
import {
  contactRateLimit,
  registerPublicContactRoutes,
} from "../publicContact";
import { withAiRequestIdentity } from "../aiRequestContext";
import {
  allowSidecarOrigin,
  enforceAppOrigin,
  rateLimit,
  securityHeaders,
} from "../security/http";
import { getProductionReadiness } from "../readiness";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => server.close(() => resolve(true)));
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++)
    if (await isPortAvailable(port)) return port;
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(securityHeaders);
  app.use(
    "/api/connector-webhooks",
    rateLimit({ limit: 120, windowMs: 60_000 })
  );
  app.use(
    "/api/connector-webhooks",
    express.raw({ type: "application/json", limit: "1mb" })
  );
  registerConnectorWebhookRoutes(app);
  // Live-call audio is base64 encoded. A 2 MB JSON ceiling keeps the existing 800 KB
  // decoded chunk limit safely below the parser boundary while remaining bounded.
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ limit: "64kb", extended: true }));
  app.use("/api/outlook/inbound", rateLimit({ limit: 120, windowMs: 60_000 }));
  registerOutlookInboundRoutes(app);
  app.get("/healthz", (_req, res) =>
    res.status(200).json({ status: "ok", service: "amarktai-sales" })
  );
  app.get("/api/health", (_req, res) =>
    res.status(200).json({ status: "ok", service: "amarktai-sales" })
  );
  app.use("/api/public/contact", rateLimit(contactRateLimit), enforceAppOrigin);
  registerPublicContactRoutes(app);
  app.get("/readyz", async (_req, res) => {
    const readiness = await getProductionReadiness();
    return res.status(readiness.status === "ready" ? 200 : 503).json(readiness);
  });
  registerCrmOAuthRoutes(app);
  app.use(
    "/api/live-calls",
    rateLimit({ limit: 40, windowMs: 60_000 }),
    enforceAppOrigin
  );
  registerLiveCallRoutes(app);
  app.use(
    "/api/voice",
    rateLimit({ limit: 20, windowMs: 60_000 }),
    enforceAppOrigin
  );
  registerVoiceRoutes(app);
  app.use(
    "/api/team-admin",
    rateLimit({ limit: 40, windowMs: 60_000 }),
    enforceAppOrigin
  );
  registerTeamAdminRoutes(app);
  app.use(
    "/api/management-settings",
    rateLimit({ limit: 30, windowMs: 60_000 }),
    enforceAppOrigin
  );
  registerManagementSettingsRoutes(app);
  app.use(
    "/api/connected-system-admin",
    rateLimit({ limit: 30, windowMs: 60_000 }),
    enforceAppOrigin
  );
  registerConnectedSystemAdminRoutes(app);
  app.use(
    "/api/company-intelligence",
    rateLimit({ limit: 12, windowMs: 60_000 }),
    enforceAppOrigin,
    withAiRequestIdentity
  );
  registerCompanyIntelligenceRoutes(app);
  app.use(
    "/api/sales-automation",
    rateLimit({ limit: 90, windowMs: 60_000 }),
    enforceAppOrigin
  );
  registerSalesAutomationRoutes(app);
  app.use(
    "/api/sales-targets",
    rateLimit({ limit: 30, windowMs: 60_000 }),
    enforceAppOrigin
  );
  registerSalesTargetsRoutes(app);
  app.use(
    "/api/ai-credits",
    rateLimit({ limit: 60, windowMs: 60_000 }),
    enforceAppOrigin
  );
  registerAiCreditsRoutes(app);
  app.use("/api/sidecar", allowSidecarOrigin);
  registerSidecarRoutes(app);
  app.use(
    "/api/trpc",
    rateLimit({ limit: 180, windowMs: 60_000 }),
    enforceAppOrigin,
    withAiRequestIdentity,
    createExpressMiddleware({ router: appRouter, createContext })
  );

  if (process.env.NODE_ENV === "development") await setupVite(app, server);
  else serveStatic(app);

  const preferredPort = Number.parseInt(process.env.PORT || "3000", 10);
  if (
    !Number.isInteger(preferredPort) ||
    preferredPort < 1 ||
    preferredPort > 65535
  )
    throw new Error("PORT must be a valid TCP port.");
  const port =
    process.env.NODE_ENV === "production"
      ? preferredPort
      : await findAvailablePort(preferredPort);
  if (process.env.NODE_ENV !== "production" && port !== preferredPort)
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  server.listen(port, "0.0.0.0", () =>
    console.log(`Server running on http://0.0.0.0:${port}/`)
  );
  startAutomaticCommissioningWorker();
}

startServer().catch(error => {
  console.error("[startup] fatal", error);
  process.exitCode = 1;
});
