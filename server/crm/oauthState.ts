import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { crmOAuthStates } from "../../drizzle/schema";
import { getDb } from "../db";

export async function createCrmOAuthState(input: { connectedSystemId: number; userId: number; redirectUri: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const nonce = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await db.insert(crmOAuthStates).values({ connectedSystemId: input.connectedSystemId, userId: input.userId, nonce, redirectUri: input.redirectUri, expiresAt });
  return nonce;
}

export async function consumeCrmOAuthState(nonce: string) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const state = (await db.select().from(crmOAuthStates).where(and(eq(crmOAuthStates.nonce, nonce), isNull(crmOAuthStates.consumedAt), gt(crmOAuthStates.expiresAt, new Date()))).limit(1))[0];
  if (!state) throw new Error("This CRM connection request is invalid, expired, or has already been used.");
  await db.update(crmOAuthStates).set({ consumedAt: new Date() }).where(and(eq(crmOAuthStates.id, state.id), isNull(crmOAuthStates.consumedAt)));
  return state;
}
