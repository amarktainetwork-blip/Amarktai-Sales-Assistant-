import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { parse as parseCookieHeader } from "cookie";
import type { User } from "../../drizzle/schema";
import { COOKIE_NAME } from "@shared/const";
import { getLocalSessionIdentity } from "../localAuth";
import { resolveActiveOrganisation, type OrganisationMembership } from "../organisation";
import { TWO_FACTOR_COOKIE, verifyTwoFactorSession } from "../twoFactor";

export type AuthenticatedUser = User & { isCron?: false };

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: AuthenticatedUser | null;
  twoFactorVerified: boolean;
  activeOrganisation: OrganisationMembership | null;
};

export async function createContext(opts: CreateExpressContextOptions): Promise<TrpcContext> {
  let user: AuthenticatedUser | null = null;
  let twoFactorVerified = false;
  let activeOrganisation: OrganisationMembership | null = null;

  try {
    const cookies = parseCookieHeader(opts.req.headers.cookie ?? "");
    const identity = await getLocalSessionIdentity(cookies[COOKIE_NAME]);
    user = identity?.user as AuthenticatedUser | null;
    if (user && identity) {
      try {
        activeOrganisation = await resolveActiveOrganisation(user.id, identity.activeOrganisationId);
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "ACTIVE_ORGANISATION_REQUIRED") throw error;
      }
    }
    if (user) twoFactorVerified = await verifyTwoFactorSession(cookies[TWO_FACTOR_COOKIE], user.id);
  } catch {
    user = null;
  }

  return { req: opts.req, res: opts.res, user, twoFactorVerified, activeOrganisation };
}
