import type { Express, Request, Response } from "express";
import { parse as parseCookieHeader } from "cookie";
import { COOKIE_NAME } from "@shared/const";
import { getLocalSessionUser, isLocalAuthMode } from "./localAuth";
import { sdk } from "./_core/sdk";
import { TWO_FACTOR_COOKIE, verifyTwoFactorSession } from "./twoFactor";
import { ensureDefaultOrganisation } from "./organisation";
import { adjustAiCredits, getAiCreditWallet, setOrganisationPlan } from "./aiCredits";
import type { PlanKey } from "../shared/pricing";

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
  return res.status(400).json({ error: detail.slice(0, 400) || "AI credit operation failed." });
}

export function registerAiCreditsRoutes(app: Express) {
  app.get("/api/ai-credits", async (req, res) => {
    try { const { userId, membership } = await authenticated(req); return res.json(await getAiCreditWallet({ userId, organisationId: membership.organisationId })); }
    catch (error) { return sendError(res, error); }
  });
  app.post("/api/ai-credits/adjust", async (req, res) => {
    try {
      const { userId, membership } = await authenticated(req);
      const transactionType = req.body?.transactionType;
      if (transactionType !== "purchase" && transactionType !== "adjustment" && transactionType !== "refund") throw new Error("A valid AI credit transaction type is required.");
      return res.json(await adjustAiCredits({ userId, organisationId: membership.organisationId, creditsDelta: Number(req.body?.creditsDelta), transactionType, note: typeof req.body?.note === "string" ? req.body.note : undefined, reference: typeof req.body?.reference === "string" ? req.body.reference : undefined }));
    } catch (error) { return sendError(res, error); }
  });
  app.put("/api/ai-credits/plan", async (req, res) => {
    try {
      const { userId, membership } = await authenticated(req);
      const planKey = String(req.body?.planKey || "") as PlanKey;
      if (!(["trial", "starter", "professional", "team"] as string[]).includes(planKey)) throw new Error("A valid plan is required.");
      return res.json(await setOrganisationPlan({ userId, organisationId: membership.organisationId, planKey }));
    } catch (error) { return sendError(res, error); }
  });
}
