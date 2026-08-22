import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { User } from "../drizzle/schema";
import { users } from "../drizzle/schema";
import { createLocalAdminIfMissing, getDb, getUserByEmail, getUserById } from "./db";
import { ensureDefaultOrganisation } from "./organisation";

const LOCAL_AUTH_MODE = "local";
const LOCAL_SESSION_TTL_SECONDS = 12 * 60 * 60;

function localAuthKey() {
  const secret = process.env.SECRET_KEY || process.env.JWT_SECRET;
  if (!secret) throw new Error("SECRET_KEY is required for local Webdock authentication.");
  return new TextEncoder().encode(secret);
}

export function isLocalAuthMode() {
  return process.env.AUTH_MODE === LOCAL_AUTH_MODE;
}

export async function authenticateLocalPassword(email: string, password: string): Promise<User | undefined> {
  if (!isLocalAuthMode()) throw new Error("Local authentication is not enabled in this environment.");
  await createLocalAdminIfMissing();
  const user = await getUserByEmail(email.trim().toLowerCase());
  if (!user?.passwordHash) return undefined;
  const valid = await bcrypt.compare(password, user.passwordHash);
  return valid ? user : undefined;
}

export async function registerLocalUser(input: { name: string; email: string; password: string }) {
  if (!isLocalAuthMode()) throw new Error("Local registration is only available on the self-hosted Webdock deployment.");
  const email = input.email.trim().toLowerCase();
  const existing = await getUserByEmail(email);
  if (existing) throw new Error("An account with that email already exists. Sign in or use password recovery.");
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const passwordHash = await bcrypt.hash(input.password, 12);
  await db.insert(users).values({ openId: `local:${randomUUID()}`, name: input.name.trim().slice(0, 160), email, loginMethod: "local", passwordHash, role: "user", lastSignedIn: new Date() });
  const user = await getUserByEmail(email);
  if (!user) throw new Error("Account could not be created.");
  const activeOrganisation = await ensureDefaultOrganisation(user.id);
  return { user, activeOrganisation };
}

export async function issuePasswordResetToken(user: User) {
  if (!user.passwordHash) throw new Error("Password recovery is not available for this account.");
  return new SignJWT({ purpose: "password_reset", passwordHash: user.passwordHash }).setProtectedHeader({ alg: "HS256" }).setSubject(String(user.id)).setIssuedAt().setExpirationTime("30m").sign(localAuthKey());
}

export async function resetLocalPassword(token: string, password: string) {
  if (!isLocalAuthMode()) throw new Error("Local password recovery is only available on the self-hosted Webdock deployment.");
  const { payload } = await jwtVerify(token, localAuthKey());
  if (payload.purpose !== "password_reset" || !payload.sub || typeof payload.passwordHash !== "string") throw new Error("This password recovery link is invalid or expired.");
  const user = await getUserById(Number(payload.sub));
  if (!user?.passwordHash || user.passwordHash !== payload.passwordHash) throw new Error("This password recovery link is invalid or has already been used.");
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  await db.update(users).set({ passwordHash: await bcrypt.hash(password, 12), lastSignedIn: new Date() }).where(eq(users.id, user.id));
  return user;
}

export type LocalSessionIdentity = { user: User; activeOrganisationId: number | null };

export async function issueLocalSession(user: User, activeOrganisationId: number | null) {
  return new SignJWT({ mode: LOCAL_AUTH_MODE, activeOrganisationId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(`${LOCAL_SESSION_TTL_SECONDS}s`)
    .sign(localAuthKey());
}

export async function getLocalSessionIdentity(token: string | undefined): Promise<LocalSessionIdentity | null> {
  if (!token || !isLocalAuthMode()) return null;
  try {
    const { payload } = await jwtVerify(token, localAuthKey());
    if (payload.mode !== LOCAL_AUTH_MODE || !payload.sub) return null;
    const user = await getUserById(Number(payload.sub));
    if (!user) return null;
    const activeOrganisationId = typeof payload.activeOrganisationId === "number" && Number.isInteger(payload.activeOrganisationId) && payload.activeOrganisationId > 0
      ? payload.activeOrganisationId
      : null;
    return { user, activeOrganisationId };
  } catch {
    return null;
  }
}

export async function getLocalSessionUser(token: string | undefined): Promise<User | null> {
  return (await getLocalSessionIdentity(token))?.user ?? null;
}

export const LOCAL_SESSION_MAX_AGE_MS = LOCAL_SESSION_TTL_SECONDS * 1000;
