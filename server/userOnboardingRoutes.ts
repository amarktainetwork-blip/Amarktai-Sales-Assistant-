import type { Express, Response } from "express";
import { and, eq } from "drizzle-orm";
import { companyProfiles, externalUserMappings } from "../drizzle/schema";
import {
  listConnectedSystemsForUser,
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
    return res
      .status(403)
      .json({ error: "Second-factor verification is required." });
  console.error(
    JSON.stringify({ event: "user_onboarding_error", detail: detail.slice(0, 300) })
  );
  return res.status(400).json({
    error:
      /identity/i.test(detail) && /crm/i.test(detail)
        ? "Confirm your salesperson identity before continuing."
        : "Your setup could not be saved. Please try again.",
  });
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

async function confirmedCompanyProfile(organisationId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const row = (
    await db
      .select({
        id: companyProfiles.id,
        discoveryStatus: companyProfiles.discoveryStatus,
        confirmedAt: companyProfiles.confirmedAt,
      })
      .from(companyProfiles)
      .where(eq(companyProfiles.organisationId, organisationId))
      .limit(1)
  )[0];
  return Boolean(
    row && row.discoveryStatus === "confirmed" && row.confirmedAt
  );
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
  const personalCrm = browserSystems.map(system => ({
    id: system.id,
    provider: system.provider,
    displayName: system.displayName,
    baseUrl: system.baseUrl,
    status: system.status,
    // CRM passwords are never a setup requirement. A user authenticates in the
    // private CRM browser when the CRM itself needs a sign-in.
    signInRequired: ["disconnected", "authentication_expired"].includes(
      system.status
    ),
  }));
  const storedCompany = companyOnboarding(input.membership.settings);
  const companyKnowledgeReady = await confirmedCompanyProfile(
    input.membership.organisationId
  );
  const crmConnected = systems.some(system =>
    [
      "connecting",
      "testing",
      "ready",
      "limited_permissions",
      "needs_attention",
      "authentication_expired",
    ].includes(system.status)
  );
  const effectiveCompanyComplete =
    storedCompany.complete || (companyKnowledgeReady && crmConnected);

  return {
    member: input.membership.memberOnboarding,
    role: input.membership.role,
    organisationId: input.membership.organisationId,
    organisationName: input.membership.organisationName,
    canManage: canManageOrganisation(input.membership.role),
    company: {
      complete: effectiveCompanyComplete,
      storedComplete: storedCompany.complete,
      step: effectiveCompanyComplete ? Math.max(4, storedCompany.step) : storedCompany.step,
      workspaceMode:
        input.membership.settings.workspaceMode === "team"
          ? "team"
          : input.membership.settings.workspaceMode === "individual"
            ? "individual"
            : null,
      knowledgeReady: companyKnowledgeReady,
      crmConnected,
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

  app.post("/api/user-onboarding/complete", async (req, res) => {
    try {
      const { userId, membership } = await requireLocalHttpContext(req);
      const current = await snapshotWithMembership({ userId, membership });
      if (!current.member.persona)
        throw new Error("Choose how you work before completing onboarding.");
      if (!current.member.primaryGoal?.trim())
        throw new Error(
          "Add your main sales goal before completing onboarding."
        );

      // Company setup is shared. New team members inherit it; they do not repeat
      // website learning, CRM commissioning, or capability testing.
      if (!current.canManage && !current.company.complete)
        throw new Error(
          "Your company workspace is still being prepared by a manager."
        );

      // Only a known salesperson mapping is a legitimate per-user blocker. CRM
      // sign-in itself happens naturally inside that user's private CRM browser.
      if (
        membership.role === "salesperson" &&
        current.identity.mappingsExist &&
        !current.identity.mapped
      )
        throw new Error("Confirm your salesperson identity in the CRM first.");

      const state = await updateMemberOnboardingState({
        userId,
        membership,
        step: 6,
        complete: true,
        crmCredentialsSaved: true,
        crmIdentityConfirmed:
          current.identity.mapped || current.member.crmIdentityConfirmed,
      });
      await recordAudit({
        userId,
        organisationId: membership.organisationId,
        eventType: "member_onboarding_completed",
        entityType: "organisation_member",
        entityId: String(userId),
        summary: "A member completed their personal Sales Assistant setup.",
        metadata: {
          role: membership.role,
          companySetupInherited: !current.canManage,
          personalCrmSignInDeferred: true,
          crmIdentityConfirmed: Boolean(current.identity.mapped),
        },
      });
      return res.json({ ok: true, member: state });
    } catch (error) {
      return sendError(res, error);
    }
  });
}
