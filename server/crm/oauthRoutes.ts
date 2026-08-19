import type { Express } from "express";
import { connectedSystems } from "../../drizzle/schema";
import { getDb } from "../db";
import { getCrmAdapter } from "./adapterRegistry";
import { consumeCrmOAuthState } from "./oauthState";
import { recordConnectionVerification, saveConnectionSecret, toAdapterConnection } from "../connectedSystems";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

function appOrigin(request: { protocol: string; get(name: string): string | undefined }) {
  const configured = process.env.APP_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return `${request.protocol}://${request.get("host")}`;
}

export function crmOAuthCallbackUrl(request: { protocol: string; get(name: string): string | undefined }) {
  return `${appOrigin(request)}/api/crm/oauth/callback`;
}

/**
 * Callback endpoints intentionally read only a single-use server-side nonce.
 * Tokens are encrypted before persistence and are never rendered in the reply.
 */
export function registerCrmOAuthRoutes(app: Express) {
  app.get("/api/crm/oauth/callback", async (req, res) => {
    const failureUrl = `${appOrigin(req)}/connections?crm_connection=failed`;
    try {
      if (typeof req.query.error === "string") throw new Error("CRM authorization was declined or could not be completed.");
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const nonce = typeof req.query.state === "string" ? req.query.state : "";
      if (!code || !nonce) throw new Error("CRM authorization response is incomplete.");
      const state = await consumeCrmOAuthState(nonce);
      const db = await getDb();
      if (!db) throw new Error("Database connection is unavailable.");
      const system = (await db.select().from(connectedSystems).where(eq(connectedSystems.id, state.connectedSystemId)).limit(1))[0];
      if (!system || system.connectionMethod !== "oauth") throw new Error("This connection no longer accepts OAuth authorization.");
      const adapter = getCrmAdapter(system.provider);
      if (!adapter.exchangeAuthorizationCode) throw new Error("This CRM adapter does not support OAuth authorization.");
      const connection = toAdapterConnection(system);
      const secret = await adapter.exchangeAuthorizationCode({ connection, code, redirectUri: state.redirectUri });
      await saveConnectionSecret({ userId: state.userId, organisationId: system.organisationId, connectedSystemId: system.id, secretKind: "oauth", secret });
      const correlationId = randomUUID();
      const test = await adapter.testConnection({ connection, secret, correlationId });
      await recordConnectionVerification({ organisationId: system.organisationId, connectedSystemId: system.id, correlationId, test });
      res.redirect(`${appOrigin(req)}/connections?crm_connection=${test.status === "ready" ? "verified" : "limited"}`);
    } catch (error) {
      console.warn("[crm-oauth-callback] authorization failed", { message: error instanceof Error ? error.message : "unknown" });
      res.redirect(failureUrl);
    }
  });
}
