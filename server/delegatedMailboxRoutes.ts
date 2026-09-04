import type { Express, Response } from "express";
import {
  completeDelegatedMailboxAuthorization,
  createDelegatedMailboxAuthorization,
} from "./delegatedMailbox";
import {
  completeGoogleMailboxAuthorization,
  createGoogleMailboxAuthorization,
} from "./googleMailbox";
import { connectPersonalSmtpMailbox } from "./smtpMailbox";
import {
  disconnectPersonalMailbox,
  getPersonalMailboxStatus,
  syncPersonalMailbox,
  type PersonalMailboxProvider,
} from "./personalMailboxRuntime";
import { requireLocalHttpContext } from "./httpAuth";

function customerError(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error || "");
  if (/AUTH_REQUIRED|TWO_FACTOR_REQUIRED/.test(detail))
    return "Please sign in and finish verification to connect your mailbox.";
  if (/not configured/i.test(detail))
    return "That mailbox connection is not enabled on this Amarktai installation yet. Ask your administrator to finish its OAuth setup.";
  if (/private|unsafe|localhost|\.local|\.internal/i.test(detail))
    return "That mail server address is not allowed. Use your provider's public SMTP hostname.";
  return detail && detail.length < 220
    ? detail
    : "Your mailbox could not be connected. Nothing else was changed, so you can try again.";
}

function sendError(res: Response, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error || "");
  return res.status(/AUTH_REQUIRED/.test(detail) ? 401 : 400).json({
    error: customerError(error),
  });
}

function provider(value: unknown): PersonalMailboxProvider | undefined {
  return value === "microsoft" || value === "google" || value === "smtp"
    ? value
    : undefined;
}

export function registerDelegatedMailboxRoutes(app: Express) {
  app.get("/api/mailbox", async (req, res) => {
    try {
      const { userId, membership } = await requireLocalHttpContext(req);
      return res.json(
        await getPersonalMailboxStatus({
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
      return res.redirect(
        302,
        "/settings?mailbox=connected&provider=microsoft#mailbox"
      );
    } catch (error) {
      const message = encodeURIComponent(customerError(error));
      return res.redirect(302, `/settings?mailbox=error&message=${message}`);
    }
  });

  app.get("/api/mailbox/google/start", async (req, res) => {
    try {
      const { userId, membership } = await requireLocalHttpContext(req);
      const authorizationUrl = await createGoogleMailboxAuthorization({
        userId,
        organisationId: membership.organisationId,
      });
      return res.redirect(302, authorizationUrl);
    } catch (error) {
      const message = encodeURIComponent(customerError(error));
      return res.redirect(302, `/settings?mailbox=error&message=${message}`);
    }
  });

  app.get("/api/mailbox/google/callback", async (req, res) => {
    try {
      const { userId, membership } = await requireLocalHttpContext(req);
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const code = typeof req.query.code === "string" ? req.query.code : "";
      if (!state || !code)
        throw new Error(
          "Google did not return the expected authorization response."
        );
      await completeGoogleMailboxAuthorization({
        userId,
        organisationId: membership.organisationId,
        state,
        code,
      });
      return res.redirect(
        302,
        "/settings?mailbox=connected&provider=google#mailbox"
      );
    } catch (error) {
      const message = encodeURIComponent(customerError(error));
      return res.redirect(302, `/settings?mailbox=error&message=${message}`);
    }
  });

  app.post("/api/mailbox/smtp", async (req, res) => {
    try {
      const { userId, membership } = await requireLocalHttpContext(req);
      const body = req.body && typeof req.body === "object" ? req.body : {};
      await connectPersonalSmtpMailbox({
        userId,
        organisationId: membership.organisationId,
        configuration: {
          email: String(body.email || ""),
          displayName:
            typeof body.displayName === "string" ? body.displayName : undefined,
          host: String(body.host || ""),
          port: Number(body.port),
          secure: Boolean(body.secure),
          username: String(body.username || ""),
          password: String(body.password || ""),
        },
      });
      return res.json(
        await getPersonalMailboxStatus({
          userId,
          organisationId: membership.organisationId,
        })
      );
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.delete("/api/mailbox", async (req, res) => {
    try {
      const { userId, membership } = await requireLocalHttpContext(req);
      await disconnectPersonalMailbox({
        userId,
        organisationId: membership.organisationId,
        provider: provider(req.query.provider),
      });
      return res.json(
        await getPersonalMailboxStatus({
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
        await syncPersonalMailbox({
          userId,
          organisationId: membership.organisationId,
          provider: provider(req.query.provider),
        })
      );
    } catch (error) {
      return sendError(res, error);
    }
  });
}
