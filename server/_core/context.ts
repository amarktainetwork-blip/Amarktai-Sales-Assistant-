import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { parse as parseCookieHeader } from "cookie";
import type { User } from "../../drizzle/schema";
import { COOKIE_NAME } from "@shared/const";
import { getLocalSessionUser, isDevelopmentPreviewUser, isLocalSessionMode } from "../localAuth";
import { TWO_FACTOR_COOKIE, verifyTwoFactorSession } from "../twoFactor";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  twoFactorVerified: boolean;
};

export async function createContext(opts: CreateExpressContextOptions): Promise<TrpcContext> {
  let user: User | null = null;
  let twoFactorVerified = false;
  try {
    const cookies = parseCookieHeader(opts.req.headers.cookie ?? "");
    if (isLocalSessionMode()) user = await getLocalSessionUser(cookies[COOKIE_NAME]);
    if (user) twoFactorVerified = isDevelopmentPreviewUser(user) || await verifyTwoFactorSession(cookies[TWO_FACTOR_COOKIE], user.id);
  } catch {
    user = null;
  }
  return { req: opts.req, res: opts.res, user, twoFactorVerified };
}
