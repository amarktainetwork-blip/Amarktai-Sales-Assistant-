import type { Express, Request, Response } from "express";
import { parse as parseCookieHeader } from "cookie";
import { COOKIE_NAME } from "@shared/const";
import { getLocalSessionUser, isLocalAuthMode } from "./localAuth";
import { sdk } from "./_core/sdk";
import { TWO_FACTOR_COOKIE, verifyTwoFactorSession } from "./twoFactor";
import { ensureDefaultOrganisation } from "./organisation";
import { getSalesTargets, normalizeSalesTargets, saveSalesTargets } from "./salesTargets";

async function authenticated(req: Request) {
  const cookies = parseCookieHeader(req.headers.cookie ?? "");
  const user = isLocalAuthMode() ? await getLocalSessionUser(cookies[COOKIE_NAME]) : await sdk.authenticateRequest(req);
  if (!user || ("isCron" in user && user.isCron)) throw new Error("AUTH_REQUIRED");
  if (!(await verifyTwoFactorSession(cookies[TWO_FACTOR_COOKIE], user.id))) throw new Error("TWO_FACTOR_REQUIRED");
  return { userId: user.id, membership: await ensureDefaultOrganisation(user.id) };
}
function sendError(res: Response, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  if (detail === "AUTH_REQUIRED") return res.status(401).json({ error: "Authentication is required." });
  if (detail === "TWO_FACTOR_REQUIRED") return res.status(403).json({ error: "Second-factor verification is required." });
  return res.status(400).json({ error: detail.slice(0, 400) || "Target operation failed." });
}

export function registerSalesTargetsRoutes(app: Express) {
  app.get("/api/sales-targets", async (req, res) => {
    try {
      const { userId, membership } = await authenticated(req);
      return res.json({ targets: await getSalesTargets({ userId, organisationId: membership.organisationId }), currency: membership.currency, timezone: membership.timezone });
    } catch (error) { return sendError(res, error); }
  });
  app.put("/api/sales-targets", async (req, res) => {
    try {
      const { userId, membership } = await authenticated(req);
      const targets = normalizeSalesTargets(req.body?.targets);
      return res.json({ targets: await saveSalesTargets({ userId, organisationId: membership.organisationId, targets }) });
    } catch (error) { return sendError(res, error); }
  });
}
