import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import { optionalLocalHttpContext } from "./httpAuth";

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
    const identity = await optionalLocalHttpContext(req);
    if (!identity) return next();
    return storage.run({ userId: identity.userId, organisationId: identity.membership.organisationId }, next);
  } catch {
    return next();
  }
}
