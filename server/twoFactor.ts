import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { ENV } from "./_core/env";

export const TWO_FACTOR_COOKIE = "amarktai_workspace_2fa";
const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_SECONDS = 12 * 60 * 60;

function signingKey() {
  return new TextEncoder().encode(ENV.cookieSecret);
}

function hashCode(userId: number, code: string) {
  return createHmac("sha256", ENV.cookieSecret).update(`${userId}:${code}`).digest("hex");
}

export function createVerificationChallenge(userId: number) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  return {
    code,
    codeHash: hashCode(userId, code),
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
  };
}

export function compareVerificationCode(userId: number, code: string, expectedHash: string) {
  const actual = Buffer.from(hashCode(userId, code));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function issueTwoFactorSession(userId: number) {
  return new SignJWT({ factor: "email" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(signingKey());
}

export async function verifyTwoFactorSession(token: string | undefined, userId: number) {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, signingKey());
    return payload.sub === String(userId) && payload.factor === "email";
  } catch {
    return false;
  }
}

export const TWO_FACTOR_MAX_AGE_MS = SESSION_TTL_SECONDS * 1000;
