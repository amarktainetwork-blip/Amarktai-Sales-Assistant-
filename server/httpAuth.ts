import type { Request } from "express";
import { parse as parseCookieHeader } from "cookie";
import { COOKIE_NAME } from "@shared/const";
import { getLocalSessionIdentity } from "./localAuth";
import { resolveActiveOrganisation, type OrganisationMembership } from "./organisation";
import { TWO_FACTOR_COOKIE, verifyTwoFactorSession } from "./twoFactor";

export type LocalHttpContext = {
  userId: number;
  membership: OrganisationMembership;
};

export async function requireLocalHttpContext(req: Request, options: { requireSecondFactor?: boolean } = {}): Promise<LocalHttpContext> {
  const cookies = parseCookieHeader(req.headers.cookie ?? "");
  const identity = await getLocalSessionIdentity(cookies[COOKIE_NAME]);
  if (!identity) throw new Error("AUTH_REQUIRED");
  const membership = await resolveActiveOrganisation(identity.user.id, identity.activeOrganisationId);
  if (options.requireSecondFactor !== false && !(await verifyTwoFactorSession(cookies[TWO_FACTOR_COOKIE], identity.user.id))) {
    throw new Error("TWO_FACTOR_REQUIRED");
  }
  return { userId: identity.user.id, membership };
}

export async function optionalLocalHttpContext(req: Request): Promise<LocalHttpContext | null> {
  try {
    return await requireLocalHttpContext(req, { requireSecondFactor: false });
  } catch {
    return null;
  }
}
