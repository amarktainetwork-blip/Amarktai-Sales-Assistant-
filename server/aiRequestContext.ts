import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import { parse as parseCookieHeader } from "cookie";
import { COOKIE_NAME } from "@shared/const";
import { getLocalSessionUser, isLocalAuthMode } from "./localAuth";
import { sdk } from "./_core/sdk";
import { ensureDefaultOrganisation } from "./organisation";

export type AiRequestIdentity = { userId: number; organisationId: number };
const storage = new AsyncLocalStorage<AiRequestIdentity>();

export function currentAiRequestIdentity() { return storage.getStore(); }

/**
 * Wraps authenticated tRPC work in an AsyncLocalStorage context. This lets the
 * central GenX boundary enforce organisation credits even for legacy callers
 * that do not explicitly pass billing metadata. Authentication/2FA enforcement
 * remains the responsibility of the actual route/procedure.
 */
export async function withAiRequestIdentity(req: Request, _res: Response, next: NextFunction) {
  try {
    const cookies = parseCookieHeader(req.headers.cookie ?? "");
    const user = isLocalAuthMode() ? await getLocalSessionUser(cookies[COOKIE_NAME]) : await sdk.authenticateRequest(req);
    if (!user || ("isCron" in user && user.isCron)) return next();
    const membership = await ensureDefaultOrganisation(user.id);
    return storage.run({ userId: user.id, organisationId: membership.organisationId }, next);
  } catch {
    return next();
  }
}
