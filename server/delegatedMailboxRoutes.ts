import type { Express, Response } from "express";
import {
  completeDelegatedMailboxAuthorization,
  createDelegatedMailboxAuthorization,
  disconnectDelegatedMailbox,
  getDelegatedMailboxStatus,
  syncDelegatedMailbox,
} from "./delegatedMailbox";
import { requireLocalHttpContext } from "./httpAuth";

function customerError(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error || "");
  if (/AUTH_REQUIRED|TWO_FACTOR_REQUIRED/.test(detail))
    return "Please sign in and finish verification to connect your mailbox.";
  if (/not configured/i.test(detail))
    return "Personal Microsoft mailbox connection is not available yet. Ask your administrator to finish the Microsoft connection setup.";
  return "Your Microsoft mailbox could not be connected. Nothing else was changed, so you can try again.";
}

function sendError(res: Response, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error || "");
  return res.status(/AUTH_REQUIRED/.test(detail) ? 401 : 400).json({
    error: customerError(error),
  });
}

export function registerDelegatedMailboxRoutes(app: Express) {
  app.get("/api/mailbox", async (req, res) => {
    try {
      const { userId, membership } = await requireLocalHttpContext(req);
      return res.json(
        await getDelegatedMailboxStatus({
          userId,
          organisationId: membership.organisationId,
        })
      );
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.get("/api/mailbox/microsoft/start", async (req, res) => {
    try {
      const { userId, membership } = await requireLocalHttpContext(req);
      const authorizationUrl = await createDelegatedMailboxAuthorization({
        userId,
        organisationId: membership.organisationId,
      });
      return res.redirect(302, authorizationUrl);
    } catch (error) {
      const message = encodeURIComponent(customerError(error));
      return res.redirect(302, `/settings?mailbox=error&message=${message}`);
    }
  });

  app.get("/api/mailbox/microsoft/callback", async (req, res) => {
    try {
      const { userId, membership } = await requireLocalHttpContext(req);
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const code = typeof req.query.code === "string" ? req.query.code : "";
      if (!state || !code)
        throw new Error(
          "Microsoft did not return the expected authorization response."
        );
      await completeDelegatedMailboxAuthorization({
        userId,
        organisationId: membership.organisationId,
        state,
        code,
      });
      return res.redirect(302, "/settings?mailbox=connected#mailbox");
    } catch (error) {
      const message = encodeURIComponent(customerError(error));
      return res.redirect(302, `/settings?mailbox=error&message=${message}`);
    }
  });

  app.delete("/api/mailbox", async (req, res) => {
    try {
      const { userId, membership } = await requireLocalHttpContext(req);
      await disconnectDelegatedMailbox({
        userId,
        organisationId: membership.organisationId,
      });
      return res.json(
        await getDelegatedMailboxStatus({
          userId,
          organisationId: membership.organisationId,
        })
      );
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/mailbox/sync", async (req, res) => {
    try {
      const { userId, membership } = await requireLocalHttpContext(req);
      return res.json(
        await syncDelegatedMailbox({
          userId,
          organisationId: membership.organisationId,
        })
      );
    } catch (error) {
      return sendError(res, error);
    }
  });
}
