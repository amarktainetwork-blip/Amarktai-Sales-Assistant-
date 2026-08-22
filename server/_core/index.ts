import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { registerDailyReportRoutes } from "../dailyReports";
import { getProductionReadiness } from "../readiness";
import { limitSensitiveProcedures, requireSameOriginForStateChanges } from "../security";
import { getConfiguredPort } from "../port";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.set("trust proxy", process.env.NODE_ENV === "production" ? 1 : false);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ limit: "100kb", extended: true }));
  app.get("/healthz", (_req, res) => res.status(200).json({ status: "alive" }));
  app.get("/readyz", async (_req, res) => {
    const readiness = await getProductionReadiness();
    res.status(readiness.status === "ready" ? 200 : 503).json(readiness);
  });
  registerDailyReportRoutes(app);
  app.use("/api/trpc", requireSameOriginForStateChanges, limitSensitiveProcedures, createExpressMiddleware({ router: appRouter, createContext }));
  if (process.env.NODE_ENV === "development") await setupVite(app, server);
  else serveStatic(app);

  const port = getConfiguredPort();
  server.on("error", error => {
    console.error("Server failed to bind configured port", error.message);
    process.exitCode = 1;
  });
  server.listen(port, () => console.log(`Server listening on configured port ${port}`));
}

startServer().catch(error => {
  console.error("Server startup failed", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
