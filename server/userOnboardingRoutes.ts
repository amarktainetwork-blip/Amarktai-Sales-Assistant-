import type { Express, Response } from "express";
import { and, eq } from "drizzle-orm";
import { externalUserMappings } from "../drizzle/schema";
import {
  getConnectedSystemForUser,
  hasUserConnectionSecret,
  listConnectedSystemsForUser,
  saveUserConnectionSecret,
} from "./connectedSystems";
import { getDb, getUserById, recordAudit } from "./db";
import { requireLocalHttpContext } from "./httpAuth";
import {
  canManageOrganisation,
  updateMemberOnboardingState,
  type MemberOnboardingState,
} from "./organisation";

function sendError(res: Response, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  if (detail === "AUTH_REQUIRED")
    return res.status(401).json({ error: "Authentication is required." });
  if (detail === "TWO_FACTOR_REQUIRED")
    return res.status(403).json({ error: "Second-factor verification is required." });
  return res
    .status(400)
    .json({ error: detail.slice(0, 500) || "Onboarding failed." });
}

function companyOnboarding(settings: Record<string, unknown>) {
  const value =
    settings.onboarding &&
    typeof settings.onboarding === "object" &&
    !Array.isArray(settings.onboarding)
      ? (settings.onboarding as Record<string, unknown>)
      : {};
  return {
    complete: value.complete === true,
    step:
      typeof value.step === "number" && Number.isInteger(value.step)
        ? value.step
        : 1,
  };
}

function cleanPersona(
  value: unknown
): MemberOnboardingState["persona"] | undefined {
  return [
    "individual",
    "company_owner",
    "manager",
    "salesperson",
    "auditor",
  ].includes(String(value))
    ? (String(value) as MemberOnboardingState["persona"])
    : undefined;
}

async function identityState(input: {
  userId: number;
  organisationId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const user = await getUserById(input.userId);
  const mappings = await db
    .select({
      id: externalUserMappings.id,
      connectedSystemId: externalUserMappings.connectedSystemId,
      externalUserId: externalUserMappings.externalUserId,
      displayName: externalUserMappings.displayName,
      email: externalUserMappings.email,
      userId: externalUserMappings.userId,
    })
    .from(externalUserMappings)
    .where(
      and(
        eq(externalUserMappings.organisationId, input.organisationId),
        eq(externalUserMappings.isActive, true)
      )
    );
  const current = mappings.filter(mapping => mapping.userId === input.userId);
  const email = user?.email?.trim().toLowerCase();
  const candidates = email
    ? mappings.filter(
        mapping =>
          mapping.userId === null &&
          mapping.email?.trim().toLowerCase() === email
      )
    : [];
  return {
    mappingsExist: mappings.length > 0,
    mapped: current.length > 0,
    current,
    candidates,
  };
}

async function snapshotWithMembership(input: {
  userId: number;
  membership: Awaited<ReturnType<typeof requireLocalHttpContext>>["membership"];
}) {
  const systems = await listConnectedSystemsForUser(
    input.userId,
    input.membership.organisationId
  );
  const browserSystems = systems.filter(
    system =>
      system.connectionMethod === "browser" ||
      system.connectionMethod === "sidecar"
  );
  const personalCrm = await Promise.all(
    browserSystems.map(async system => ({
      id: system.id,
      provider: system.provider,
      displayName: system.displayName,
      baseUrl: system.baseUrl,
      status: system.status,
      hasCredentials: await hasUserConnectionSecret({
        userId: input.userId,
        organisationId: input.membership.organisationId,
        connectedSystemId: system.id,
        secretKind: "browser",
      }),
    }))
  );
  return {
    member: input.membership.memberOnboarding,
    role: input.membership.role,
    organisationId: input.membership.organisationId,
    organisationName: input.membership.organisationName,
    canManage: canManageOrganisation(input.membership.role),
    company: {
      ...companyOnboarding(input.membership.settings),
      workspaceMode:
        input.membership.settings.workspaceMode === "team"
          ? "team"
          : input.membership.settings.workspaceMode === "individual"
            ? "individual"
            : null,
    },
    personalCrm,
    identity: await identityState({
      userId: input.userId,
      organisationId: input.membership.organisationId,
    }),
  };
}

export function registerUserOnboardingRoutes(app: Express) {
  app.get("/api/user-onboarding", async (req, res) => {
    try {
      const { userId, membership } = await requireLocalHttpContext(req);
      return res.json(await snapshotWithMembership({ userId, membership }));
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.put("/api/user-onboarding", async (req, res) => {
    try {
      const { userId, membership } = await requireLocalHttpContext(req);
      const step =
        req.body?.step === undefined ? undefined : Number(req.body.step);
      if (
        step !== undefined &&
        (!Number.isInteger(step) || step < 1 || step > 6)
      )
        throw new Error("Onboarding step must be between 1 and 6.");
      const state = await updateMemberOnboardingState({
        userId,
        membership,
        step,
        persona: cleanPersona(req.body?.persona),
        primaryGoal:
          typeof req.body?.primaryGoal === "string"
            ? req.body.primaryGoal
            : undefined,
        workingStyle:
          typeof req.body?.workingStyle === "string"
            ? req.body.workingStyle
            : undefined,
      });
      return res.json({ ok: true, member: state });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.put("/api/user-onboarding/crm/:id/credentials", async (req, res) => {
    try {
      const { userId, membership } = await requireLocalHttpContext(req);
      const connectedSystemId = Number(req.params.id);
      if (!Number.isInteger(connectedSystemId) || connectedSystemId <= 0)
        throw new Error("Choose a valid CRM connection.");
      const system = await getConnectedSystemForUser(
        userId,
        membership.organisationId,
        connectedSystemId
      );
      if (
        system.connectionMethod !== "browser" &&
        system.connectionMethod !== "sidecar"
      )
        throw new Error(
          "Personal credentials are only required for browser-based CRM connections."
        );
      const username =
        typeof req.body?.username === "string"
          ? req.body.username.trim().slice(0, 500)
          : "";
      const password =
        typeof req.body?.password === "string"
          ? req.body.password.slice(0, 2000)
          : "";
      if (!username || !password)
        throw new Error("CRM username and password are both required.");
      await saveUserConnectionSecret({
        userId,
        organisationId: membership.organisationId,
        connectedSystemId,
        secretKind: "browser",
        secret: { credentials: { username, password } },
      });
      await updateMemberOnboardingState({
        userId,
        membership,
        crmCredentialsSaved: true,
      });
      await recordAudit({
        userId,
        organisationId: membership.organisationId,
        eventType: "member_crm_credentials_saved",
        entityType: "connected_system",
        entityId: String(connectedSystemId),
        summary: `${system.displayName} personal CRM credentials were encrypted for this member.`,
        metadata: {
          personalCredentialScope: true,
          credentialContentRetainedInAudit: false,
        },
      });
      return res.json({ ok: true, credentialsSaved: true });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/user-onboarding/complete", async (req, res) => {
    try {
      const { userId, membership } = await requireLocalHttpContext(req);
      const current = await snapshotWithMembership({ userId, membership });
      if (!current.member.persona)
        throw new Error("Choose how you work before completing onboarding.");
      if (!current.member.primaryGoal?.trim())
        throw new Error("Add your main sales goal before completing onboarding.");

      // Company setup is separate. Owners/managers may finish their own personal
      // onboarding first and are then sent into company setup. Non-managers must
      // inherit a completed company setup before entering the sales workspace.
      if (!current.canManage && !current.company.complete)
        throw new Error(
          "Your company setup is not finished yet. Your manager must complete it before your workspace can open."
        );

      const browserConnection = current.personalCrm[0];
      if (
        browserConnection &&
        membership.role !== "auditor" &&
        !browserConnection.hasCredentials
      )
        throw new Error(
          `Save your own ${browserConnection.displayName} login before completing onboarding.`
        );

      if (
        membership.role === "salesperson" &&
        current.identity.mappingsExist &&
        !current.identity.mapped
      )
        throw new Error(
          "Confirm your matching salesperson identity in the CRM before completing onboarding."
        );

      const state = await updateMemberOnboardingState({
        userId,
        membership,
        step: 6,
        complete: true,
        crmCredentialsSaved:
          browserConnection?.hasCredentials ?? current.member.crmCredentialsSaved,
        crmIdentityConfirmed:
          current.identity.mapped || current.member.crmIdentityConfirmed,
      });
      await recordAudit({
        userId,
        organisationId: membership.organisationId,
        eventType: "member_onboarding_completed",
        entityType: "organisation_member",
        entityId: String(userId),
        summary: "A member completed their mandatory first-login onboarding.",
        metadata: {
          role: membership.role,
          companySetupInherited: !current.canManage,
          personalCrmCredentials: Boolean(browserConnection?.hasCredentials),
          crmIdentityConfirmed: Boolean(current.identity.mapped),
        },
      });
      return res.json({ ok: true, member: state });
    } catch (error) {
      return sendError(res, error);
    }
  });
}
