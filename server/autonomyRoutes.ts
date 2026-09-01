import type { Express, Response } from "express";
import {
  autonomyPermissions,
  normalizeAutonomySettings,
} from "../shared/autonomyPolicy";
import { requireLocalHttpContext } from "./httpAuth";
import { getUserAutonomy, updateUserAutonomy } from "./autonomy";

function sendError(res: Response, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error || "");
  return res.status(/AUTH_REQUIRED/.test(detail) ? 401 : 400).json({
    error: /AUTH_REQUIRED|TWO_FACTOR_REQUIRED/.test(detail)
      ? "Please sign in and finish verification to continue."
      : "Your autonomy settings could not be saved. Nothing was changed.",
  });
}

export function registerAutonomyRoutes(app: Express) {
  app.get("/api/autonomy", async (req, res) => {
    try {
      const { userId, membership } = await requireLocalHttpContext(req);
      return res.json(
        await getUserAutonomy({
          userId,
          organisationId: membership.organisationId,
        })
      );
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.put("/api/autonomy", async (req, res) => {
    try {
      const { userId, membership } = await requireLocalHttpContext(req);
      const requested = normalizeAutonomySettings(req.body);
      const suppliedPermissions = req.body?.permissions;
      if (
        suppliedPermissions &&
        (typeof suppliedPermissions !== "object" ||
          Array.isArray(suppliedPermissions) ||
          Object.keys(suppliedPermissions).some(
            key => !autonomyPermissions.includes(key as never)
          ))
      )
        throw new Error("Invalid autonomy permission.");
      return res.json(
        await updateUserAutonomy({
          userId,
          organisationId: membership.organisationId,
          settings: requested,
        })
      );
    } catch (error) {
      return sendError(res, error);
    }
  });
}
