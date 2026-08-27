import type { connectedSystems } from "../../drizzle/schema";
import {
  loadConnectionSecret,
  loadUserConnectionSecret,
} from "../connectedSystems";
import type { ConnectionSecretPayload } from "./types";

type ConnectedSystem = typeof connectedSystems.$inferSelect;

export function runtimeSecretKind(system: Pick<ConnectedSystem, "connectionMethod">) {
  return system.connectionMethod === "browser" || system.connectionMethod === "sidecar"
    ? "browser"
    : "oauth";
}

export function requiresPersonalRuntimeSecret(
  system: Pick<ConnectedSystem, "connectionMethod">
) {
  return runtimeSecretKind(system) === "browser";
}

export async function loadRuntimeSecretForUser(input: {
  userId: number;
  organisationId: number;
  system: Pick<ConnectedSystem, "id" | "connectionMethod" | "displayName">;
}): Promise<ConnectionSecretPayload> {
  const kind = runtimeSecretKind(input.system);
  if (kind === "browser") {
    const secret = await loadUserConnectionSecret({
      userId: input.userId,
      organisationId: input.organisationId,
      connectedSystemId: input.system.id,
      secretKind: "browser",
    });
    if (!secret)
      throw new Error(
        `PERSONAL_CRM_CREDENTIALS_REQUIRED: ${input.system.displayName} needs this user's own encrypted CRM login before CRM work can run.`
      );
    return secret;
  }

  const secret = await loadConnectionSecret({
    organisationId: input.organisationId,
    connectedSystemId: input.system.id,
    secretKind: "oauth",
  });
  if (!secret)
    throw new Error(
      `CRM_CONNECTION_SECRET_REQUIRED: ${input.system.displayName} does not have an approved OAuth session.`
    );
  return secret;
}
