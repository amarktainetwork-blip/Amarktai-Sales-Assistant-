import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { parse as parseCookieHeader } from "cookie";
import type { User } from "../../drizzle/schema";
import { COOKIE_NAME } from "@shared/const";
import { getLocalSessionUser, isLocalAuthMode } from "../localAuth";
import { TWO_FACTOR_COOKIE, verifyTwoFactorSession } from "../twoFactor";
import { sdk, type AuthenticatedUser } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: AuthenticatedUser | null;
  twoFactorVerified: boolean;
};

export async function createContext(opts: CreateExpressContextOptions): Promise<TrpcContext> {
  let user: AuthenticatedUser | null = null;
  let twoFactorVerified = false;

  try {
    const cookies = parseCookieHeader(opts.req.headers.cookie ?? "");
    if (isLocalAuthMode()) {
      user = await getLocalSessionUser(cookies[COOKIE_NAME]) as AuthenticatedUser | null;
    } else {
      user = await sdk.authenticateRequest(opts.req);
    }
    if (user && !user.isCron) twoFactorVerified = await verifyTwoFactorSession(cookies[TWO_FACTOR_COOKIE], user.id);
  } catch {
    user = null;
  }

  return { req: opts.req, res: opts.res, user, twoFactorVerified };
}
