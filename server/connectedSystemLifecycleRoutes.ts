import type { Express, Request, Response } from "express";
import {
  disconnectConnectedSystem,
  getConnectedSystemIdentityClusterForUser,
} from "./connectedSystems";
import { closeLiveCrmViewerSessionsForConnection } from "./liveCrmViewer";
import { managedCrmBrowserSessionManager } from "./browserConnectors/managedCrmBrowserSessionManager";
import { requireManagementHttpContext } from "./managementElevation";
import { canManageOrganisation } from "./organisationAccess";

async function requireManager(req: Request) {
  const { userId, membership, user } = await requireManagementHttpContext(req);
  if (!user.isPlatformOwner && !canManageOrganisation(membership.role))
    throw new Error("MANAGER_REQUIRED");
  return { userId, membership };
}

function publicError(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  if (detail === "AUTH_REQUIRED")
    return { status: 401, message: "Authentication is required." };
  if (detail === "TWO_FACTOR_REQUIRED")
    return { status: 403, message: "Second-factor verification is required." };
  if (detail === "MANAGER_REQUIRED")
    return { status: 403, message: "A management role is required." };
  if (detail.startsWith("MANAGEMENT_ELEVATION_"))
    return {
      status: 403,
      message: "Confirm your management password before disconnecting a CRM.",
    };
  return {
    status: 400,
    message: "The CRM could not be disconnected safely. Try again.",
  };
}

function sendError(res: Response, error: unknown) {
  const safe = publicError(error);
  const detail = error instanceof Error ? error.message : String(error);
  console.error(
    JSON.stringify({
      event: "connected_system_disconnect_error",
      detail: detail.slice(0, 300),
    })
  );
  return res.status(safe.status).json({ error: safe.message });
}

export function registerConnectedSystemLifecycleRoutes(app: Express) {
  app.post(
    "/api/connected-system-admin/:id/disconnect",
    async (req, res) => {
      try {
        const { userId, membership } = await requireManager(req);
        const connectedSystemId = Number(req.params.id);
        if (!Number.isInteger(connectedSystemId) || connectedSystemId <= 0)
          throw new Error("CONNECTED_SYSTEM_REQUIRED");

        // Legacy duplicate rows can point at the same real CRM. Stop every
        // active runtime in that identity cluster before deleting auth material.
        const cluster = await getConnectedSystemIdentityClusterForUser({
          userId,
          organisationId: membership.organisationId,
          connectedSystemId,
        });
        for (const system of cluster) {
          closeLiveCrmViewerSessionsForConnection({
            organisationId: membership.organisationId,
            connectedSystemId: system.id,
          });
          await managedCrmBrowserSessionManager.teardownConnection(
            membership.organisationId,
            system.id
          );
        }

        const result = await disconnectConnectedSystem({
          userId,
          organisationId: membership.organisationId,
          connectedSystemId,
        });
        return res.json({
          ok: true,
          connectedSystemId,
          status: "disconnected" as const,
          retiredConnectionIds: result.retiredIds,
          crmHistoryPreserved: true,
          authenticationRemoved: true,
        });
      } catch (error) {
        return sendError(res, error);
      }
    }
  );
}
