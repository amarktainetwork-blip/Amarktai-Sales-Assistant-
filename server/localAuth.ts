import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../drizzle/schema";
import { createLocalAdminIfMissing, getUserByEmail, getUserById } from "./db";

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

export async function issueLocalSession(user: User) {
  return new SignJWT({ mode: LOCAL_AUTH_MODE })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(`${LOCAL_SESSION_TTL_SECONDS}s`)
    .sign(localAuthKey());
}

export async function getLocalSessionUser(token: string | undefined): Promise<User | null> {
  if (!token || !isLocalAuthMode()) return null;
  try {
    const { payload } = await jwtVerify(token, localAuthKey());
    if (payload.mode !== LOCAL_AUTH_MODE || !payload.sub) return null;
    return (await getUserById(Number(payload.sub))) ?? null;
  } catch {
    return null;
  }
}

export const LOCAL_SESSION_MAX_AGE_MS = LOCAL_SESSION_TTL_SECONDS * 1000;
