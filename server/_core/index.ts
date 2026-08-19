import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { isLocalAuthMode } from "../localAuth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { registerDailyReportRoutes } from "../dailyReports";
import { registerCrmOAuthRoutes } from "../crm/oauthRoutes";
import { registerSidecarRoutes } from "../sidecar/routes";
import { allowSidecarOrigin, enforceAppOrigin, rateLimit, securityHeaders } from "../security/http";
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
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(securityHeaders);
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ limit: "32kb", extended: true }));
  app.get("/api/health", (_req, res) => res.status(200).json({ status: "ok", service: "amarktai-sales" }));
  registerStorageProxy(app);
  if (!isLocalAuthMode()) registerOAuthRoutes(app);
  registerDailyReportRoutes(app);
  registerCrmOAuthRoutes(app);
  app.use("/api/sidecar", allowSidecarOrigin);
  registerSidecarRoutes(app);
  app.use(
    "/api/trpc",
    rateLimit({ limit: 180, windowMs: 60_000 }),
    enforceAppOrigin,
    createExpressMiddleware({ router: appRouter, createContext }),
  );

  if (process.env.NODE_ENV === "development") await setupVite(app, server);
  else serveStatic(app);

  const preferredPort = Number.parseInt(process.env.PORT || "3000", 10);
  if (!Number.isInteger(preferredPort) || preferredPort < 1 || preferredPort > 65535) throw new Error("PORT must be a valid TCP port.");

  // Production reverse proxies and container health checks target an exact port.
  // Silently choosing a different port would leave a healthy process unreachable.
  const port = process.env.NODE_ENV === "production" ? preferredPort : await findAvailablePort(preferredPort);
  if (process.env.NODE_ENV !== "production" && port !== preferredPort) console.log(`Port ${preferredPort} is busy, using port ${port} instead`);

  server.listen(port, "0.0.0.0", () => console.log(`Server running on http://0.0.0.0:${port}/`));
}

startServer().catch(error => {
  console.error("[startup] fatal", error);
  process.exitCode = 1;
});
