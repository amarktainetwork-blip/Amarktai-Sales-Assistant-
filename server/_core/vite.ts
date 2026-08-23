import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Express } from "express";
import express from "express";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const clientDir = path.join(rootDir, "client");
const productionPublicDir = path.join(rootDir, "dist", "public");

/** Serve the local Vite SPA during development; Vite is loaded only on demand. */
export async function setupVite(app: Express, server: Server) {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    configFile: path.join(rootDir, "vite.config.ts"),
    root: clientDir,
    appType: "spa",
    server: { middlewareMode: true, hmr: { server } },
  });
  app.use(vite.middlewares);
}

/** Serve only the bundled local SPA in the self-hosted production container. */
export function serveStatic(app: Express) {
  app.use(express.static(productionPublicDir, { index: false, maxAge: "1h" }));
  app.get("*", (_req, res) => res.sendFile(path.join(productionPublicDir, "index.html")));
}
