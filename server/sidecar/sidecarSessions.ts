import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { sidecarSessions } from "../../drizzle/schema";
import { getDb } from "../db";
import { requireOrganisationMembership } from "../organisation";

function hash(token: string) { return createHash("sha256").update(token).digest("hex"); }

export async function issueSidecarSession(input: { userId: number; organisationId: number }) {
  await requireOrganisationMembership(input.userId, input.organisationId);
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  await db.insert(sidecarSessions).values({ organisationId: input.organisationId, userId: input.userId, tokenHash: hash(token), expiresAt });
  return { token, expiresAt };
}

export async function validateSidecarSession(token: string) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const session = (await db.select().from(sidecarSessions).where(and(eq(sidecarSessions.tokenHash, hash(token)), isNull(sidecarSessions.revokedAt), gt(sidecarSessions.expiresAt, new Date()))).limit(1))[0];
  if (!session) throw new Error("The browser sidecar session is invalid or expired. Reconnect it from Amarktai.");
  return { organisationId: session.organisationId, userId: session.userId };
}

export async function revokeSidecarSessions(input: { userId: number; organisationId: number }) {
  await requireOrganisationMembership(input.userId, input.organisationId);
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  await db.update(sidecarSessions).set({ revokedAt: new Date() }).where(and(eq(sidecarSessions.organisationId, input.organisationId), eq(sidecarSessions.userId, input.userId), isNull(sidecarSessions.revokedAt)));
}
