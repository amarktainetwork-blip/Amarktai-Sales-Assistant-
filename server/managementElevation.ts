import bcrypt from "bcryptjs";
import { parse as parseCookieHeader } from "cookie";
import { errors as JoseErrors, jwtVerify, SignJWT } from "jose";
import type { Request } from "express";
import type { OrganisationRole } from "./organisationAccess";
import { ENV } from "./_core/env";
import { getUserById, recordAudit } from "./db";
import { requireLocalHttpContext } from "./httpAuth";

export const MANAGEMENT_ELEVATION_COOKIE = "amarktai_management_elevation";

export function managementElevationTtlMinutes(value = process.env.MANAGEMENT_ELEVATION_TTL_MINUTES) {
  const parsed = Number.parseInt(value || "45", 10);
  return Number.isFinite(parsed) ? Math.min(240, Math.max(5, parsed)) : 45;
}
export function managementElevationMaxAgeMs() { return managementElevationTtlMinutes() * 60_000; }
function key() { return new TextEncoder().encode(ENV.cookieSecret); }

export async function issueManagementElevation(userId: number) {
  const ttl = managementElevationTtlMinutes() * 60;
  return new SignJWT({ purpose: "management_elevation" }).setProtectedHeader({ alg: "HS256" }).setSubject(String(userId)).setIssuedAt().setExpirationTime(`${ttl}s`).sign(key());
}

export type ManagementElevationStatus = "valid" | "missing" | "expired" | "invalid";
export async function verifyManagementElevation(token: string | undefined, userId: number): Promise<ManagementElevationStatus> {
  if (!token) return "missing";
  try {
    const { payload } = await jwtVerify(token, key());
    return payload.sub === String(userId) && payload.purpose === "management_elevation" ? "valid" : "invalid";
  } catch (error) {
    return error instanceof JoseErrors.JWTExpired ? "expired" : "invalid";
  }
}

export function assertManagementElevation(input: { role: OrganisationRole; isPlatformOwner: boolean; status: ManagementElevationStatus }) {
  if (!input.isPlatformOwner && input.role !== "owner" && input.role !== "manager") throw new Error("MANAGER_REQUIRED");
  if (input.status !== "valid") throw new Error(input.status === "expired" ? "MANAGEMENT_ELEVATION_EXPIRED" : "MANAGEMENT_ELEVATION_REQUIRED");
}

export async function verifyManagementPassword(userId: number, password: string) {
  const user = await getUserById(userId);
  if (!user?.passwordHash) return false;
  return bcrypt.compare(password, user.passwordHash);
}

export async function requireManagementHttpContext(req: Request) {
  const context = await requireLocalHttpContext(req);
  const user = await getUserById(context.userId);
  if (!user) throw new Error("AUTH_REQUIRED");
  const cookies = parseCookieHeader(req.headers.cookie || "");
  const status = await verifyManagementElevation(cookies[MANAGEMENT_ELEVATION_COOKIE], user.id);
  if (status === "expired") await recordAudit({ userId: user.id, organisationId: context.membership.organisationId, eventType: "management_elevation_expired", entityType: "user", entityId: String(user.id), summary: "A sensitive management request was denied because elevation expired.", metadata: {} }).catch(() => undefined);
  assertManagementElevation({ role: context.membership.role, isPlatformOwner: user.isPlatformOwner, status });
  return { ...context, user, managementElevationStatus: status };
}
