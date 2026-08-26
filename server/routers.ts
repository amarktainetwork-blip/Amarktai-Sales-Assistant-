import { z } from "zod";
import { parse as parseCookieHeader } from "cookie";
import { TRPCError } from "@trpc/server";
import { AGENT_CATALOG, agentRuntimeStatus, WORKFLOW_KEYS } from "./agentCatalog";
import {
  createCallSession,
  confirmWebsiteDiscovery,
  createDailyReport,
  createTwoFactorChallenge,
  createIntegrationProfile,
  createKnowledgeSource,
  createWorkflowRun,
  createLiveCallSession,
  getAssistantDashboard,
  getCompanySetup,
  getAssistantOperationalContext,
  getOperationsDashboard,
  getOperationalAnalytics,
  getWorkspaceExportData,
  getUserByEmail,
  claimApprovedActionProposal,
  recordActionExecution,
  attachDailyReportTask,
  consumeValidTwoFactorChallenge,
  listDailyReports,
  listActionProposals,
  listWorkspaceSavedItems,
  listIntegrationProfiles,
  listKnowledgeSources,
  searchApprovedKnowledge,
  listAuditEntries,
  listProposalAuditEntries,
  reviewActionProposal,
  saveAutomationPlaybook,
  saveWorkspaceSavedItem,
  removeWorkspaceSavedItem,
  upsertCompanyProfile,
  appendLiveTranscript,
  completeLiveCallSession,
  recordAudit,
  saveWebsiteDiscoveryReview,
  listCrmCustomers,
} from "./db";
import { getGenxReadiness, runGenxAgent } from "./genx";
import { getOrganisationGenieReadiness } from "./genie/organisationReadiness";
import { executeApprovedCrmAction } from "./crm/executeApprovedAction";
import { planAssistantCrmBatchInstruction } from "./crm/assistantBatchExecution";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import {
  protectedProcedure,
  publicProcedure,
  router,
  secondFactorProcedure,
  managementProcedure,
} from "./_core/trpc";
import { buildWorkflowPlan } from "./workflowRules";
import {
  compareVerificationCode,
  createVerificationChallenge,
  issueTwoFactorSession,
  TWO_FACTOR_COOKIE,
  TWO_FACTOR_MAX_AGE_MS,
} from "./twoFactor";
import { getSmtpReadiness, sendEmail, sendSecondFactorCode } from "./smtp";
import { createHeartbeatJob } from "./_core/heartbeat";
import {
  authenticateLocalPassword,
  isLocalAuthMode,
  issueLocalSession,
  issuePasswordResetToken,
  LOCAL_SESSION_MAX_AGE_MS,
  registerLocalUser,
  resetLocalPassword,
} from "./localAuth";
import { routeSalesCommand } from "./supervisor";
import { prepareGovernedAssistantRequest } from "./governedAssistant";
import { prepareLiveCoachingTip, preparePostCallSummary } from "./liveCoach";
import { getOutlookReadiness, validateEmailPreview } from "./outlook";
import { discoverAndReviewCompanyIntelligence } from "./companyIntelligenceService";
import { routeConnectedSystemActions } from "./crmRouter";
import {
  ensureDefaultOrganisation,
  canManageOrganisation,
  listOrganisationMemberships,
  requireOrganisationMembership,
  type OrganisationMembership,
  updateOnboardingState,
} from "./organisation";
import {
  addAuthorisedDomain,
  createConnectedSystem,
  getConnectedSystemForUser,
  listConnectedSystemsForUser,
  loadConnectionSecret,
  recordConnectionVerification,
  toAdapterConnection,
} from "./connectedSystems";
import { getCrmAdapter } from "./crm/adapterRegistry";
import { createCrmOAuthState } from "./crm/oauthState";
import { crmOAuthCallbackUrl } from "./crm/oauthRoutes";
import { syncConnectedSystem } from "./crm/sync";
import { getTodayWork } from "./today";
import {
  acquireAiControl,
  createLiveCrmViewerSession,
  getSanitisedLiveCrmContext,
  releaseAiControl,
} from "./liveCrmViewer";
import {
  issueSidecarSession,
  revokeSidecarSessions,
} from "./sidecar/sidecarSessions";
import { getTeamIntelligence } from "./teamIntelligence";
import { createHash, randomUUID } from "node:crypto";
import { requireActiveOrganisationContext } from "./activeOrganisationGuard";
import { checkRateLimit } from "./security/http";
import { createExportDownload, type ExportSection } from "./exportDocuments";
import {
  createBrowserTrainingSession,
  getGuidedBrowserOperationReview,
  listBrowserOperationMatrix,
  saveGuidedBrowserOperationReview,
  saveLearnedBrowserOperation,
  setBrowserShadowMode,
} from "./browserConnectors/learnedOperations";
import {
  getLiveCallContext,
  searchLiveCallContacts,
  startLiveCallForContact,
  startLiveCallFromToday,
  getWorkingContextForContact,
} from "./liveCalls/context";
import {
  createAssistantMemory,
  createReminder,
  executeAssistantMemoryCommand,
  listUserReminders,
  updateReminderStatus,
} from "./memory";
import {
  issueManagementElevation,
  managementElevationMaxAgeMs,
  MANAGEMENT_ELEVATION_COOKIE,
  verifyManagementPassword,
} from "./managementElevation";

const workflowInput = z.object({
  workflowKey: z.enum(WORKFLOW_KEYS),
  leadLabel: z.string().trim().min(1).max(160),
  callOutcome: z.enum(["no_answer", "voicemail", "answered"]).optional(),
  conversationNotes: z.string().trim().max(12_000).optional(),
});

const publicConnectionLabels = {
  genie: "CRM workspace bridge",
  outlook: "Messaging and calendar link",
  genx: "Amarktai intelligence service",
} as const;

function presentConnectionProfile<
  T extends {
    provider: keyof typeof publicConnectionLabels;
    displayName: string;
    scopeSummary: string | null;
  },
>(profile: T) {
  const productLabel = publicConnectionLabels[profile.provider];
  return {
    ...profile,
    displayName: productLabel,
    scopeSummary: `Amarktai Network ${productLabel.toLowerCase()} profile. Technical configuration details remain server-side.`,
  };
}

function publicAuthClientKey(req: {
  ip?: string;
  socket?: { remoteAddress?: string };
}) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

async function enforcePublicAuthRateLimit(input: {
  req: { ip?: string; socket?: { remoteAddress?: string } };
  operation: "register" | "recovery" | "reset";
  email?: string;
}) {
  const policy =
    input.operation === "register"
      ? { limit: 5, windowMs: 60 * 60_000 }
      : { limit: 3, windowMs: 15 * 60_000 };
  const keys = [
    `amarktai:public-auth:${input.operation}:ip:${publicAuthClientKey(input.req)}`,
  ];
  if (input.email)
    keys.push(
      `amarktai:public-auth:${input.operation}:identity:${createHash("sha256").update(input.email.trim().toLowerCase()).digest("hex")}`
    );
  for (const key of keys) {
    const result = await checkRateLimit({
      key,
      ...policy,
      securitySensitive: true,
    });
    if (!result)
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message:
          "Authentication protection is temporarily unavailable. Try again shortly.",
      });
    if (!result.allowed)
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Too many authentication requests. Try again shortly.",
      });
  }
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    mode: publicProcedure.query(() => ({ local: isLocalAuthMode() })),
    localLogin: publicProcedure
      .input(
        z.object({
          email: z.string().email(),
          password: z.string().min(12).max(160),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (!isLocalAuthMode())
          throw new Error(
            "Local login is only available on the self-hosted Webdock deployment."
          );
        const user = await authenticateLocalPassword(
          input.email,
          input.password
        );
        if (!user) throw new Error("Invalid email or password.");
        const memberships = await listOrganisationMemberships(user.id);
        const activeOrganisation =
          memberships.length === 0
            ? await ensureDefaultOrganisation(user.id)
            : memberships.length === 1
              ? memberships[0]
              : null;
        const token = await issueLocalSession(
          user,
          activeOrganisation?.organisationId ?? null
        );
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, token, {
          ...cookieOptions,
          maxAge: LOCAL_SESSION_MAX_AGE_MS,
        });
        return {
          success: true,
          activeOrganisation,
          organisationSelectionRequired: activeOrganisation === null,
        };
      }),
    register: publicProcedure
      .input(
        z.object({
          name: z.string().trim().min(2).max(160),
          email: z.string().email().max(320),
          password: z.string().min(12).max(160),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await enforcePublicAuthRateLimit({
          req: ctx.req,
          operation: "register",
          email: input.email,
        });
        const { user, activeOrganisation } = await registerLocalUser(input);
        const token = await issueLocalSession(
          user,
          activeOrganisation.organisationId
        );
        ctx.res.cookie(COOKIE_NAME, token, {
          ...getSessionCookieOptions(ctx.req),
          maxAge: LOCAL_SESSION_MAX_AGE_MS,
        });
        return {
          success: true,
          activeOrganisation,
          twoFactorRequired: true as const,
        };
      }),
    requestPasswordReset: publicProcedure
      .input(z.object({ email: z.string().email().max(320) }))
      .mutation(async ({ ctx, input }) => {
        await enforcePublicAuthRateLimit({
          req: ctx.req,
          operation: "recovery",
          email: input.email,
        });
        if (!isLocalAuthMode()) return { success: true } as const;
        const account = await getUserByEmail(input.email.trim().toLowerCase());
        if (
          account?.email &&
          account.passwordHash &&
          getSmtpReadiness().ready
        ) {
          try {
            const token = await issuePasswordResetToken(account);
            const url = new URL(
              "/auth",
              process.env.APP_PUBLIC_URL || "http://localhost:3000"
            );
            url.searchParams.set("reset", token);
            await sendEmail({
              to: account.email,
              subject: "Reset your Amarktai workspace password",
              text: `Use this one-time link within 30 minutes to reset your password: ${url.toString()}`,
              html: `<main style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h1>Reset your workspace password</h1><p>Use the link below within 30 minutes. If you did not request this, you can ignore this email.</p><p><a href="${url.toString()}">Reset password</a></p></main>`,
            });
          } catch (error) {
            console.warn(
              JSON.stringify({
                event: "password_reset_delivery_failed",
                detail:
                  error instanceof Error
                    ? error.message.slice(0, 160)
                    : String(error).slice(0, 160),
              })
            );
          }
        }
        return { success: true } as const;
      }),
    resetPassword: publicProcedure
      .input(
        z.object({
          token: z.string().min(20).max(4000),
          password: z.string().min(12).max(160),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await enforcePublicAuthRateLimit({ req: ctx.req, operation: "reset" });
        const user = await resetLocalPassword(input.token, input.password);
        const memberships = await listOrganisationMemberships(user.id);
        const activeOrganisation =
          memberships.length === 0
            ? await ensureDefaultOrganisation(user.id)
            : memberships.length === 1
              ? memberships[0]
              : null;
        const session = await issueLocalSession(
          user,
          activeOrganisation?.organisationId ?? null
        );
        ctx.res.cookie(COOKIE_NAME, session, {
          ...getSessionCookieOptions(ctx.req),
          maxAge: LOCAL_SESSION_MAX_AGE_MS,
        });
        return {
          success: true,
          activeOrganisation,
          organisationSelectionRequired: activeOrganisation === null,
          twoFactorRequired: true as const,
        };
      }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      ctx.res.clearCookie(MANAGEMENT_ELEVATION_COOKIE, {
        ...cookieOptions,
        maxAge: -1,
      });
      return { success: true } as const;
    }),
  }),
  security: router({
    status: protectedProcedure.query(({ ctx }) => ({
      verified: ctx.twoFactorVerified,
      hasEmail: Boolean(ctx.user.email),
      smtpReady: getSmtpReadiness().ready,
    })),
    requestEmailCode: protectedProcedure.mutation(async ({ ctx }) => {
      if (!ctx.user.email)
        throw new Error(
          "Your account has no email address. Add one to the self-hosted administrator configuration before enabling workspace access."
        );
      if (!getSmtpReadiness().ready)
        throw new Error(
          "Email verification is not configured yet. Add the SMTP deployment secrets before enabling two-factor access."
        );
      const challenge = createVerificationChallenge(ctx.user.id);
      await createTwoFactorChallenge({
        userId: ctx.user.id,
        codeHash: challenge.codeHash,
        expiresAt: challenge.expiresAt,
      });
      await sendSecondFactorCode({ to: ctx.user.email, code: challenge.code });
      return { success: true };
    }),
    verifyEmailCode: protectedProcedure
      .input(z.object({ code: z.string().regex(/^\d{6}$/) }))
      .mutation(async ({ ctx, input }) => {
        const valid = await consumeValidTwoFactorChallenge({
          userId: ctx.user.id,
          isValid: hash =>
            compareVerificationCode(ctx.user.id, input.code, hash),
        });
        if (!valid)
          throw new Error(
            "That verification code is invalid, expired, or has reached its attempt limit."
          );
        const token = await issueTwoFactorSession(ctx.user.id);
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(TWO_FACTOR_COOKIE, token, {
          ...cookieOptions,
          maxAge: TWO_FACTOR_MAX_AGE_MS,
        });
        if (ctx.activeOrganisation)
          await recordAudit({
            userId: ctx.user.id,
            organisationId: ctx.activeOrganisation.organisationId,
            eventType: "two_factor_verified",
            entityType: "user",
            entityId: String(ctx.user.id),
            summary: "A user completed secure second-factor workspace access.",
            metadata: { factor: "email", codeStored: false },
          });
        return { success: true };
      }),
  }),
  managementElevation: router({
    status: secondFactorProcedure.query(({ ctx }) => ({
      eligible: Boolean(
        ctx.activeOrganisation &&
          (ctx.user.isPlatformOwner ||
            canManageOrganisation(ctx.activeOrganisation.role))
      ),
      elevated: ctx.managementElevationStatus === "valid",
      status: ctx.managementElevationStatus,
      ttlMinutes: Math.round(managementElevationMaxAgeMs() / 60_000),
    })),
    start: secondFactorProcedure
      .input(z.object({ password: z.string().min(1).max(200) }))
      .mutation(async ({ ctx, input }) => {
        if (
          !ctx.activeOrganisation ||
          (!ctx.user.isPlatformOwner &&
            !canManageOrganisation(ctx.activeOrganisation.role))
        )
          throw new Error("MANAGER_REQUIRED");
        if (!(await verifyManagementPassword(ctx.user.id, input.password)))
          throw new Error("Management identity verification failed.");
        const token = await issueManagementElevation(ctx.user.id);
        ctx.res.cookie(MANAGEMENT_ELEVATION_COOKIE, token, {
          ...getSessionCookieOptions(ctx.req),
          maxAge: managementElevationMaxAgeMs(),
        });
        await recordAudit({
          userId: ctx.user.id,
          organisationId: ctx.activeOrganisation.organisationId,
          eventType: "management_elevation_started",
          entityType: "user",
          entityId: String(ctx.user.id),
          summary:
            "Sensitive management mode was activated after identity re-verification.",
          metadata: {
            ttlMinutes: Math.round(managementElevationMaxAgeMs() / 60_000),
          },
        });
        return {
          success: true,
          ttlMinutes: Math.round(managementElevationMaxAgeMs() / 60_000),
        };
      }),
    revoke: secondFactorProcedure.mutation(async ({ ctx }) => {
      ctx.res.clearCookie(MANAGEMENT_ELEVATION_COOKIE, {
        ...getSessionCookieOptions(ctx.req),
        maxAge: -1,
      });
      if (ctx.activeOrganisation)
        await recordAudit({
          userId: ctx.user.id,
          organisationId: ctx.activeOrganisation.organisationId,
          eventType: "management_elevation_revoked",
          entityType: "user",
          entityId: String(ctx.user.id),
          summary: "Sensitive management mode was revoked.",
          metadata: {},
        });
      return { success: true };
    }),
  }),
  assistant: router({
    dashboard: secondFactorProcedure.query(({ ctx }) => {
      if (!ctx.activeOrganisation)
        throw new Error(
          "Choose an organisation before accessing workspace data."
        );
      return getAssistantDashboard(
        ctx.user.id,
        ctx.activeOrganisation.organisationId
      );
    }),
    operationsDashboard: secondFactorProcedure.query(async ({ ctx }) => {
      if (!ctx.activeOrganisation)
        throw new Error(
          "Choose an organisation before accessing workspace data."
        );
      const dashboard = await getOperationsDashboard(
        ctx.user.id,
        ctx.activeOrganisation.organisationId
      );
      const systems = await listConnectedSystemsForUser(
        ctx.user.id,
        ctx.activeOrganisation.organisationId
      );
      const genieReadiness = await getOrganisationGenieReadiness(
        ctx.activeOrganisation.organisationId,
        systems
      );
      return {
        ...dashboard,
        connectionReadiness: {
          crmBrowserBridge: genieReadiness.ready,
          microsoftConnection: getOutlookReadiness().ready,
          intelligenceService: getGenxReadiness().ready,
          emailDelivery: getSmtpReadiness().ready,
        },
      };
    }),
    exportWorkspaceData: secondFactorProcedure
      .input(
        z.object({
          kind: z.enum(["operational_report", "conversation_log"]),
          format: z.enum(["csv", "pdf"]),
          callSessionId: z.number().int().positive().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const organisation = ctx.activeOrganisation;
        if (!organisation)
          throw new Error(
            "Choose an organisation before exporting workspace data."
          );
        const data = await getWorkspaceExportData({
          userId: ctx.user.id,
          organisationId: organisation.organisationId,
          kind: input.kind,
          callSessionId: input.callSessionId,
        });
        const compactText = (value: string | null) =>
          value ? value.replace(/\s+/g, " ").trim().slice(0, 12_000) : "";
        const sections: ExportSection[] =
          input.kind === "conversation_log"
            ? [
                {
                  title: "Factual conversation logs",
                  columns: [
                    "Call ID",
                    "Contact",
                    "Status",
                    "Transcript",
                    "Coach notes",
                    "Summary",
                    "Updated",
                  ],
                  rows: data.calls.map(call => [
                    call.id,
                    call.leadLabel,
                    call.status,
                    compactText(call.transcript),
                    compactText(call.coachNotes),
                    compactText(call.summary),
                    call.updatedAt,
                  ]),
                },
              ]
            : [
                {
                  title: "Action proposals",
                  columns: [
                    "Proposal ID",
                    "Contact",
                    "Action",
                    "Title",
                    "State",
                    "Created",
                    "Executed",
                  ],
                  rows: (data.proposals ?? []).map(proposal => [
                    proposal.id,
                    proposal.targetLabel,
                    proposal.actionType,
                    proposal.title,
                    proposal.state,
                    proposal.createdAt,
                    proposal.executedAt,
                  ]),
                },
                {
                  title: "Callback tasks",
                  columns: [
                    "Task ID",
                    "Contact",
                    "Title",
                    "Priority",
                    "State",
                    "Due",
                    "Updated",
                  ],
                  rows: (data.callbacks ?? []).map(task => [
                    task.id,
                    task.leadLabel,
                    task.title,
                    task.priority,
                    task.state,
                    task.dueAt,
                    task.updatedAt,
                  ]),
                },
                {
                  title: "Call sessions",
                  columns: [
                    "Call ID",
                    "Contact",
                    "Status",
                    "Created",
                    "Updated",
                  ],
                  rows: data.calls.map(call => [
                    call.id,
                    call.leadLabel,
                    call.status,
                    call.createdAt,
                    call.updatedAt,
                  ]),
                },
                {
                  title: "Decision audit",
                  columns: [
                    "Audit ID",
                    "Event",
                    "Entity",
                    "Summary",
                    "Created",
                  ],
                  rows: (data.audit ?? []).map(entry => [
                    entry.id,
                    entry.eventType,
                    `${entry.entityType}:${entry.entityId ?? ""}`,
                    entry.summary,
                    entry.createdAt,
                  ]),
                },
              ];
        const stem =
          input.kind === "conversation_log"
            ? "amarktai-conversation-logs"
            : "amarktai-operational-report";
        return createExportDownload({
          title:
            input.kind === "conversation_log"
              ? "Amarktai factual conversation logs"
              : "Amarktai operational report",
          filenameStem: `${stem}-${organisation.organisationId}-${new Date().toISOString().slice(0, 10)}`,
          format: input.format,
          sections,
        });
      }),
    routeCommand: secondFactorProcedure
      .input(z.object({ command: z.string().trim().min(4).max(4_000) }))
      .mutation(({ input }) => routeSalesCommand(input.command)),
    agents: secondFactorProcedure.query(async ({ ctx }) => {
      const genx = getGenxReadiness();
      let systems: Awaited<ReturnType<typeof listConnectedSystemsForUser>> = [];
      let databaseReady = true;
      if (ctx.activeOrganisation) {
        try {
          systems = await listConnectedSystemsForUser(ctx.user.id, ctx.activeOrganisation.organisationId);
        } catch {
          databaseReady = false;
        }
      }
      const verified = systems.filter(system => system.status === "ready");
      const dependencies = {
        databaseReady,
        genxReady: genx.ready,
        crmReadReady: verified.some(system => system.verifiedCapabilities.some(capability => capability.endsWith(".read"))),
        crmRouteReady: verified.some(system => system.verifiedCapabilities.length > 0),
        communicationsReady: verified.some(system => system.verifiedCapabilities.some(capability => ["email.send", "sms.send", "whatsapp.send"].includes(capability))),
        voiceReady: false,
      };
      return { agents: AGENT_CATALOG.map(agent => ({ ...agent, runtime: agentRuntimeStatus(agent.key, dependencies) })), genx };
    }),
    actions: secondFactorProcedure
      .input(
        z
          .object({ workflowRunId: z.number().int().positive().optional() })
          .optional()
      )
      .query(({ ctx, input }) => {
        if (!ctx.activeOrganisation)
          throw new Error(
            "Choose an organisation before accessing workspace actions."
          );
        return listActionProposals(
          ctx.user.id,
          ctx.activeOrganisation.organisationId,
          input?.workflowRunId
        );
      }),
    savedItems: router({
      list: secondFactorProcedure.query(({ ctx }) => {
        if (!ctx.activeOrganisation)
          throw new Error(
            "Choose an organisation before accessing saved items."
          );
        return listWorkspaceSavedItems(
          ctx.user.id,
          ctx.activeOrganisation.organisationId
        );
      }),
      save: secondFactorProcedure
        .input(
          z.object({
            targetType: z.enum(["action_proposal", "lead", "pitch"]),
            targetKey: z.string().trim().min(1).max(160),
            title: z.string().trim().min(1).max(220),
            tags: z.array(z.string().trim().min(1).max(48)).max(12),
            isFavorite: z.boolean(),
          })
        )
        .mutation(({ ctx, input }) => {
          if (!ctx.activeOrganisation)
            throw new Error("Choose an organisation before saving an item.");
          return saveWorkspaceSavedItem({
            userId: ctx.user.id,
            organisationId: ctx.activeOrganisation.organisationId,
            ...input,
          });
        }),
      remove: secondFactorProcedure
        .input(z.object({ id: z.number().int().positive() }))
        .mutation(async ({ ctx, input }) => {
          if (!ctx.activeOrganisation)
            throw new Error(
              "Choose an organisation before removing a saved item."
            );
          await removeWorkspaceSavedItem({
            userId: ctx.user.id,
            organisationId: ctx.activeOrganisation.organisationId,
            id: input.id,
          });
          return { success: true };
        }),
    }),
    prepareWorkflow: secondFactorProcedure
      .input(workflowInput)
      .mutation(async ({ ctx, input }) => {
        const plan = buildWorkflowPlan(input);
        const organisation = ctx.activeOrganisation;
        if (!organisation)
          throw new Error(
            "Choose an organisation before preparing workflow actions."
          );
        const systems = await listConnectedSystemsForUser(
          ctx.user.id,
          organisation.organisationId
        );
        const routedActions = routeConnectedSystemActions(
          plan.actions,
          systems
        );
        const workflowRunId = await createWorkflowRun({
          userId: ctx.user.id,
          organisationId: organisation.organisationId,
          workflowKey: input.workflowKey,
          leadLabel: input.leadLabel,
          payload: input,
          verificationSummary: plan.verificationSummary,
          actions: routedActions,
        });
        return {
          workflowRunId,
          verificationSummary: plan.verificationSummary,
          actionCount: routedActions.length,
          blockedActionCount: routedActions.filter(
            action =>
              (action.payload.crmRoute as { routable?: boolean } | undefined)
                ?.routable === false
          ).length,
        };
      }),
    reviewAction: secondFactorProcedure
      .input(
        z.object({
          proposalId: z.number().int().positive(),
          state: z.enum(["approved", "skipped"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (!ctx.activeOrganisation)
          throw new Error("Choose an organisation before reviewing actions.");
        await reviewActionProposal(
          ctx.user.id,
          ctx.activeOrganisation.organisationId,
          input.proposalId,
          input.state
        );
        return { success: true };
      }),
    proposalAudit: secondFactorProcedure
      .input(z.object({ proposalId: z.number().int().positive() }))
      .query(({ ctx, input }) => {
        if (!ctx.activeOrganisation)
          throw new Error(
            "Choose an organisation before accessing action audit."
          );
        return listProposalAuditEntries(
          ctx.user.id,
          ctx.activeOrganisation.organisationId,
          input.proposalId
        );
      }),
    executeApprovedCrmAction: secondFactorProcedure
      .input(z.object({ proposalId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const correlationId = randomUUID();
        const organisation = ctx.activeOrganisation;
        if (!organisation)
          throw new Error(
            "Choose an organisation before executing CRM actions."
          );
        const proposal = await claimApprovedActionProposal({
          userId: ctx.user.id,
          organisationId: organisation.organisationId,
          proposalId: input.proposalId,
          correlationId,
        });
        if (!proposal)
          throw new Error(
            "Only an approved action proposal may be executed, and it must be owned by your workspace."
          );
        const result = await executeApprovedCrmAction({
          organisationId: organisation.organisationId,
          proposal,
          correlationId,
        });
        await recordActionExecution({
          userId: ctx.user.id,
          organisationId: organisation.organisationId,
          proposalId: proposal.id,
          correlationId,
          success: result.success,
          result,
        });
        if (!result.success)
          throw new Error(`CRM action failed: ${result.detail}`);
        return result;
      }),
    chat: secondFactorProcedure
      .input(
        z.object({
          agentKey: z.string().min(1).max(80),
          contactId: z.number().int().positive().optional(),
          messages: z
            .array(
              z.object({
                role: z.enum(["user", "assistant"]),
                content: z.string().min(1).max(12_000),
              })
            )
            .min(1)
            .max(18),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const query = input.messages
          .filter(message => message.role === "user")
          .map(message => message.content)
          .join("\n");
        if (!ctx.activeOrganisation)
          throw new Error("Choose an organisation before using the assistant.");
        const batchAction = planAssistantCrmBatchInstruction(query);
        if (batchAction) {
          const systems = await listConnectedSystemsForUser(
            ctx.user.id,
            ctx.activeOrganisation.organisationId
          );
          const routed = routeConnectedSystemActions([batchAction], systems);
          const workflowRunId = await createWorkflowRun({
            userId: ctx.user.id,
            organisationId: ctx.activeOrganisation.organisationId,
            workflowKey: "assistant_deterministic_batch",
            leadLabel: batchAction.targetLabel,
            payload: { instruction: query, plannerCalls: 1 },
            verificationSummary:
              "The assistant interpreted this structured multi-record instruction once. The one batch proposal must be reviewed before any deterministic CRM operations run.",
            actions: routed,
          });
          const routable = Boolean(
            (routed[0].payload.crmRoute as { routable?: boolean } | undefined)
              ?.routable
          );
          return {
            content: routable
              ? `I prepared one governed batch proposal for ${query.trim()} Review and approve proposal workflow ${workflowRunId}; execution will page the verified CRM, filter structured records deterministically, verify every change, and return one final result.`
              : "I understood the batch request, but no connected CRM has the verified operation required to prepare it for execution. Finish that CRM function's setup first.",
            provider: "deterministic_planner" as const,
            usage: {},
            creditsCharged: 0,
          };
        }
        const [sources, today, contactContext, operationalContext] =
          await Promise.all([
            searchApprovedKnowledge(
              ctx.user.id,
              ctx.activeOrganisation.organisationId,
              query
            ),
            getTodayWork({
              userId: ctx.user.id,
              organisationId: ctx.activeOrganisation.organisationId,
            }),
            input.contactId
              ? getWorkingContextForContact({
                  organisationId: ctx.activeOrganisation.organisationId,
                  contactId: input.contactId,
                })
              : Promise.resolve(undefined),
            getAssistantOperationalContext(
              ctx.user.id,
              ctx.activeOrganisation.organisationId
            ),
          ]);
        const approvedKnowledge = sources.length
          ? sources
              .map(
                source =>
                  `[${source.title}]\n${source.content ?? source.sourceUrl ?? "No retained body."}`
              )
              .join("\n\n---\n\n")
          : undefined;
        const workingContext = JSON.stringify({
          selectedCustomer: contactContext ?? null,
          today: {
            generatedAt: today.generatedAt,
            metrics: today.metrics,
            priority: today.queues.priority
              .slice(0, 5)
              .map(item => ({
                id: item.id,
                name: item.name,
                pipeline: item.pipeline,
                stage: item.stage,
                reasons: item.reasons,
                nextStepAt: item.nextStepAt,
              })),
            callbacks: today.queues.callbacks
              .slice(0, 5)
              .map(item => ({
                title: item.title,
                leadLabel: item.leadLabel,
                dueAt: item.dueAt,
              })),
            reminders: today.queues.reminders
              .slice(0, 5)
              .map(item => ({ title: item.title, dueAt: item.dueAt })),
          },
          recentCalls: operationalContext.recentCalls,
          approvedPlaybooks: operationalContext.approvedPlaybooks,
          allowedActions: operationalContext.allowedActions,
          connections: operationalContext.connections,
        });
        const response = await runGenxAgent({
          ...input,
          approvedKnowledge,
          workingContext,
        });
        await recordAudit({
          userId: ctx.user.id,
          organisationId: ctx.activeOrganisation.organisationId,
          eventType: "assistant_response_generated",
          entityType: "assistant",
          entityId: String(ctx.user.id),
          summary:
            "The live context-aware Assistant generated a response through the configured intelligence path.",
          metadata: {
            provider: response.provider,
            creditsCharged: response.creditsCharged,
            contentRetained: false,
          },
        });
        return response;
      }),
  }),
  organisation: router({
    available: protectedProcedure.query(({ ctx }) =>
      listOrganisationMemberships(ctx.user.id)
    ),
    current: secondFactorProcedure.query(({ ctx }) => {
      if (!ctx.activeOrganisation)
        throw new Error(
          "Choose an organisation before accessing workspace data."
        );
      return ctx.activeOrganisation;
    }),
    updateOnboarding: secondFactorProcedure
      .input(
        z.object({
          workspaceMode: z.enum(["individual", "team"]).optional(),
          step: z.number().int().min(1).max(8).optional(),
          complete: z.boolean().optional(),
        })
      )
      .mutation(({ ctx, input }) => {
        if (!ctx.activeOrganisation)
          throw new Error("Choose an organisation before updating setup.");
        return updateOnboardingState({
          userId: ctx.user.id,
          membership: ctx.activeOrganisation,
          ...input,
        });
      }),
    switch: protectedProcedure
      .input(z.object({ organisationId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const membership = await requireOrganisationMembership(
          ctx.user.id,
          input.organisationId
        );
        const token = await issueLocalSession(
          ctx.user,
          membership.organisationId
        );
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, token, {
          ...cookieOptions,
          maxAge: LOCAL_SESSION_MAX_AGE_MS,
        });
        return membership;
      }),
  }),
  connectedSystems: router({
    list: secondFactorProcedure
      .input(z.object({ organisationId: z.number().int().positive() }))
      .query(({ ctx, input }) => {
        requireActiveOrganisationContext(ctx, input.organisationId);
        return listConnectedSystemsForUser(ctx.user.id, input.organisationId);
      }),
    create: managementProcedure
      .input(
        z.object({
          organisationId: z.number().int().positive(),
          provider: z.enum([
            "genie",
            "hubspot",
            "salesforce",
            "pipedrive",
            "zoho",
            "custom_browser",
          ]),
          displayName: z.string().trim().min(2).max(180),
          baseUrl: z.string().url().max(1024).optional().nullable(),
          connectionMethod: z.enum(["oauth", "browser", "sidecar"]),
          allowedReadCapabilities: z
            .array(z.string().trim().min(3).max(80))
            .max(20),
          allowedWriteCapabilities: z
            .array(z.string().trim().min(3).max(80))
            .max(20),
        })
      )
      .mutation(({ ctx, input }) => {
        requireActiveOrganisationContext(ctx, input.organisationId);
        return createConnectedSystem({ userId: ctx.user.id, ...input });
      }),
    addDomain: managementProcedure
      .input(
        z.object({
          organisationId: z.number().int().positive(),
          connectedSystemId: z.number().int().positive(),
          hostname: z.string().trim().min(3).max(253),
          allowedPaths: z.array(z.string().trim().min(1).max(500)).max(40),
        })
      )
      .mutation(({ ctx, input }) => {
        requireActiveOrganisationContext(ctx, input.organisationId);
        return addAuthorisedDomain({ userId: ctx.user.id, ...input });
      }),
    beginOAuth: managementProcedure
      .input(
        z.object({
          organisationId: z.number().int().positive(),
          connectedSystemId: z.number().int().positive(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const membership = requireActiveOrganisationContext(
          ctx,
          input.organisationId
        );
        if (
          !ctx.user.isPlatformOwner &&
          !canManageOrganisation(membership.role)
        )
          throw new Error(
            "Only organisation owners and managers can authenticate connected systems."
          );
        const system = await getConnectedSystemForUser(
          ctx.user.id,
          input.organisationId,
          input.connectedSystemId
        );
        const adapter = getCrmAdapter(system.provider);
        if (
          !adapter.createAuthorizationUrl ||
          system.connectionMethod !== "oauth"
        )
          throw new Error(
            "This connected system does not support OAuth authorization."
          );
        const redirectUri = crmOAuthCallbackUrl(ctx.req);
        const state = await createCrmOAuthState({
          connectedSystemId: system.id,
          userId: ctx.user.id,
          redirectUri,
        });
        return {
          authorizationUrl: adapter.createAuthorizationUrl({
            connection: toAdapterConnection(system),
            state,
            redirectUri,
          }),
        };
      }),
    verify: managementProcedure
      .input(
        z.object({
          organisationId: z.number().int().positive(),
          connectedSystemId: z.number().int().positive(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const membership = requireActiveOrganisationContext(
          ctx,
          input.organisationId
        );
        if (
          !ctx.user.isPlatformOwner &&
          !canManageOrganisation(membership.role)
        )
          throw new Error(
            "Only organisation owners and managers can test connected systems."
          );
        const system = await getConnectedSystemForUser(
          ctx.user.id,
          input.organisationId,
          input.connectedSystemId
        );
        const adapter = getCrmAdapter(system.provider);
        const secret = await loadConnectionSecret({
          organisationId: input.organisationId,
          connectedSystemId: system.id,
          secretKind: "oauth",
        });
        const correlationId = randomUUID();
        const test = await adapter.testConnection({
          connection: toAdapterConnection(system),
          secret,
          correlationId,
        });
        const outcome = await recordConnectionVerification({
          organisationId: input.organisationId,
          connectedSystemId: system.id,
          correlationId,
          test,
        });
        return { ...outcome, summary: test.summary, correlationId };
      }),
    sync: secondFactorProcedure
      .input(
        z.object({
          organisationId: z.number().int().positive(),
          connectedSystemId: z.number().int().positive(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const membership = requireActiveOrganisationContext(
          ctx,
          input.organisationId
        );
        if (!canManageOrganisation(membership.role))
          throw new Error(
            "Only organisation owners and managers can synchronize connected systems."
          );
        return syncConnectedSystem({ userId: ctx.user.id, ...input });
      }),
    browserOperationMatrix: secondFactorProcedure
      .input(
        z.object({
          organisationId: z.number().int().positive(),
          connectedSystemId: z.number().int().positive(),
        })
      )
      .query(({ ctx, input }) => {
        requireActiveOrganisationContext(ctx, input.organisationId);
        return listBrowserOperationMatrix({ userId: ctx.user.id, ...input });
      }),
    browserOperationReview: secondFactorProcedure
      .input(
        z.object({
          organisationId: z.number().int().positive(),
          connectedSystemId: z.number().int().positive(),
          operationKey: z.string().trim().min(3).max(120),
        })
      )
      .query(({ ctx, input }) => {
        requireActiveOrganisationContext(ctx, input.organisationId);
        return getGuidedBrowserOperationReview({
          userId: ctx.user.id,
          ...input,
        });
      }),
    reviewBrowserOperation: managementProcedure
      .input(
        z.object({
          organisationId: z.number().int().positive(),
          connectedSystemId: z.number().int().positive(),
          learnedOperationId: z.number().int().positive(),
          operationKey: z.string().trim().min(3).max(120),
          review: z.object({
            steps: z
              .array(
                z.object({
                  action: z.enum([
                    "goto",
                    "fill",
                    "click",
                    "press",
                    "select_option",
                    "check",
                    "uncheck",
                    "expect_visible",
                    "wait_for_url",
                  ]),
                  selector: z.string().max(2_000).optional(),
                  value: z.string().max(4_000).optional(),
                })
              )
              .min(1)
              .max(80),
            output: z
              .object({
                action: z.enum(["read_text", "read_value", "read_rows"]),
                selector: z.string().trim().min(1).max(2_000),
                key: z.string().trim().min(1).max(120),
                fields: z
                  .array(
                    z.object({
                      key: z.string().trim().min(1).max(120),
                      selector: z.string().max(2_000).optional(),
                      attribute: z.string().max(120).optional(),
                    })
                  )
                  .max(40)
                  .optional(),
              })
              .optional(),
            target: z
              .object({
                rowSelector: z.string().trim().min(1).max(2_000),
                mode: z.enum(["must_match", "must_not_exist"]).optional(),
                fields: z
                  .array(
                    z.object({
                      key: z.enum([
                        "externalId",
                        "taskId",
                        "opportunityId",
                        "name",
                        "email",
                        "phone",
                        "company",
                      ]),
                      selector: z.string().max(2_000).optional(),
                      attribute: z.string().max(120).optional(),
                    })
                  )
                  .min(1)
                  .max(7),
              })
              .optional(),
            postcondition: z
              .object({
                action: z.enum(["read_text", "read_value", "read_attribute"]),
                selector: z.string().trim().min(1).max(2_000),
                key: z.string().trim().min(1).max(120),
                attribute: z.string().max(120).optional(),
                expectedInput: z.string().max(120).optional(),
                expectedValue: z.string().max(2_000).optional(),
                comparator: z
                  .enum(["equals", "contains", "exists", "not_equals"])
                  .optional(),
              })
              .optional(),
          }),
        })
      )
      .mutation(({ ctx, input }) => {
        requireActiveOrganisationContext(ctx, input.organisationId);
        return saveGuidedBrowserOperationReview({
          userId: ctx.user.id,
          ...input,
        });
      }),
    saveBrowserOperation: managementProcedure
      .input(
        z.object({
          organisationId: z.number().int().positive(),
          connectedSystemId: z.number().int().positive(),
          operationKey: z.string().trim().min(3).max(120),
          definition: z.record(z.string(), z.unknown()),
          prerequisites: z.record(z.string(), z.unknown()).optional(),
          targetAssertions: z.record(z.string(), z.unknown()).optional(),
          postconditionAssertions: z
            .array(
              z.object({
                actualKey: z.string().trim().min(1).max(120),
                expectedInput: z.string().trim().min(1).max(120).optional(),
                expectedValue: z.string().max(2_000).optional(),
                comparator: z
                  .enum(["equals", "contains", "exists", "not_equals"])
                  .optional(),
              })
            )
            .max(40)
            .optional(),
        })
      )
      .mutation(({ ctx, input }) => {
        requireActiveOrganisationContext(ctx, input.organisationId);
        return saveLearnedBrowserOperation({ userId: ctx.user.id, ...input });
      }),
    startBrowserTraining: managementProcedure
      .input(
        z.object({
          organisationId: z.number().int().positive(),
          connectedSystemId: z.number().int().positive(),
          operationKey: z.string().trim().min(3).max(120),
        })
      )
      .mutation(({ ctx, input }) => {
        requireActiveOrganisationContext(ctx, input.organisationId);
        return createBrowserTrainingSession({ userId: ctx.user.id, ...input });
      }),
    setBrowserShadowMode: managementProcedure
      .input(
        z.object({
          organisationId: z.number().int().positive(),
          connectedSystemId: z.number().int().positive(),
          enabled: z.boolean(),
        })
      )
      .mutation(({ ctx, input }) => {
        requireActiveOrganisationContext(ctx, input.organisationId);
        return setBrowserShadowMode({ userId: ctx.user.id, ...input });
      }),
  }),
  sales: router({
    today: secondFactorProcedure
      .input(z.object({ organisationId: z.number().int().positive() }))
      .query(({ ctx, input }) => {
        requireActiveOrganisationContext(ctx, input.organisationId);
        return getTodayWork({
          userId: ctx.user.id,
          organisationId: input.organisationId,
        });
      }),
    customers: secondFactorProcedure.query(({ ctx }) => {
      if (!ctx.activeOrganisation)
        throw new Error("Choose an organisation before loading customers.");
      return listCrmCustomers(ctx.activeOrganisation.organisationId);
    }),
  }),
  memory: router({
    command: secondFactorProcedure
      .input(
        z.object({
          command: z.string().trim().min(8).max(2_000),
          contactExternalId: z.string().trim().max(160).optional(),
          opportunityExternalId: z.string().trim().max(160).optional(),
        })
      )
      .mutation(({ ctx, input }) => {
        if (!ctx.activeOrganisation)
          throw new Error("Choose an organisation before saving memory.");
        return executeAssistantMemoryCommand({
          userId: ctx.user.id,
          organisationId: ctx.activeOrganisation.organisationId,
          timezone: ctx.activeOrganisation.timezone,
          ...input,
        });
      }),
    createReminder: secondFactorProcedure
      .input(
        z.object({
          title: z.string().trim().min(1).max(300),
          dueAt: z.coerce.date(),
          timezone: z.string().trim().min(1).max(80),
          details: z.string().max(10_000).optional(),
          contactExternalId: z.string().trim().max(160).optional(),
          opportunityExternalId: z.string().trim().max(160).optional(),
        })
      )
      .mutation(({ ctx, input }) => {
        if (!ctx.activeOrganisation)
          throw new Error("Choose an organisation before saving a reminder.");
        return createReminder({
          userId: ctx.user.id,
          organisationId: ctx.activeOrganisation.organisationId,
          source: "manual",
          ...input,
        });
      }),
    createFact: secondFactorProcedure
      .input(
        z.object({
          memoryType: z.enum([
            "user_preference",
            "customer_fact",
            "conversation_reference",
          ]),
          subject: z.string().trim().min(1).max(220),
          content: z.string().trim().min(1).max(20_000),
          contactExternalId: z.string().trim().max(160).optional(),
          opportunityExternalId: z.string().trim().max(160).optional(),
        })
      )
      .mutation(({ ctx, input }) => {
        if (!ctx.activeOrganisation)
          throw new Error("Choose an organisation before saving memory.");
        return createAssistantMemory({
          userId: ctx.user.id,
          organisationId: ctx.activeOrganisation.organisationId,
          provenance: "user_asserted",
          ...input,
        });
      }),
    reminders: secondFactorProcedure
      .input(z.object({ includeHistory: z.boolean().optional() }).optional())
      .query(({ ctx, input }) => {
        if (!ctx.activeOrganisation)
          throw new Error("Choose an organisation before loading reminders.");
        return listUserReminders({
          userId: ctx.user.id,
          organisationId: ctx.activeOrganisation.organisationId,
          includeHistory: input?.includeHistory,
        });
      }),
    updateReminder: secondFactorProcedure
      .input(
        z.object({
          reminderId: z.number().int().positive(),
          status: z.enum(["open", "snoozed", "completed", "cancelled"]),
          snoozedUntil: z.coerce.date().optional(),
        })
      )
      .mutation(({ ctx, input }) => {
        if (!ctx.activeOrganisation)
          throw new Error("Choose an organisation before updating a reminder.");
        return updateReminderStatus({
          userId: ctx.user.id,
          organisationId: ctx.activeOrganisation.organisationId,
          ...input,
        });
      }),
  }),
  management: router({
    teamIntelligence: secondFactorProcedure
      .input(z.object({ organisationId: z.number().int().positive() }))
      .query(({ ctx, input }) => {
        requireActiveOrganisationContext(ctx, input.organisationId);
        return getTeamIntelligence({
          userId: ctx.user.id,
          organisationId: input.organisationId,
        });
      }),
  }),
  sidecar: router({
    issueSession: secondFactorProcedure
      .input(z.object({ organisationId: z.number().int().positive() }))
      .mutation(({ ctx, input }) => {
        requireActiveOrganisationContext(ctx, input.organisationId);
        return issueSidecarSession({
          userId: ctx.user.id,
          organisationId: input.organisationId,
        });
      }),
    revokeSessions: secondFactorProcedure
      .input(z.object({ organisationId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        requireActiveOrganisationContext(ctx, input.organisationId);
        await revokeSidecarSessions({
          userId: ctx.user.id,
          organisationId: input.organisationId,
        });
        return { success: true };
      }),
  }),
  integrations: router({
    list: secondFactorProcedure.query(async ({ ctx }) => {
      if (!ctx.activeOrganisation)
        throw new Error(
          "Choose an organisation before accessing integrations."
        );
      const systems = await listConnectedSystemsForUser(
        ctx.user.id,
        ctx.activeOrganisation.organisationId
      );
      return {
        profiles: (
          await listIntegrationProfiles(
            ctx.user.id,
            ctx.activeOrganisation.organisationId
          )
        ).map(presentConnectionProfile),
        genx: getGenxReadiness(),
        outlook: getOutlookReadiness(),
        genie: await getOrganisationGenieReadiness(
          ctx.activeOrganisation.organisationId,
          systems
        ),
      };
    }),
    createProfile: secondFactorProcedure
      .input(
        z.object({
          provider: z.enum(["genie", "outlook", "genx"]),
          displayName: z.string().trim().min(2).max(140),
          scopeSummary: z.string().trim().max(800).optional(),
        })
      )
      .mutation(({ ctx, input }) => {
        if (!ctx.activeOrganisation)
          throw new Error(
            "Choose an organisation before creating an integration profile."
          );
        return createIntegrationProfile({
          userId: ctx.user.id,
          organisationId: ctx.activeOrganisation.organisationId,
          ...input,
        });
      }),
  }),
  crmViewer: router({
    open: secondFactorProcedure
      .input(z.object({ connectedSystemId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.activeOrganisation)
          throw new Error("Choose a company before opening its CRM workspace.");
        return createLiveCrmViewerSession({
          userId: ctx.user.id,
          organisationId: ctx.activeOrganisation.organisationId,
          connectedSystemId: input.connectedSystemId,
        });
      }),
    acquireAssistantControl: secondFactorProcedure
      .input(z.object({ viewerSessionId: z.string().uuid() }))
      .mutation(({ ctx, input }) => {
        if (!ctx.activeOrganisation)
          throw new Error("Choose a company before controlling its CRM workspace.");
        return acquireAiControl(
          input.viewerSessionId,
          ctx.activeOrganisation.organisationId,
          ctx.user.id
        );
      }),
    releaseAssistantControl: secondFactorProcedure
      .input(z.object({ viewerSessionId: z.string().uuid() }))
      .mutation(({ ctx, input }) => {
        if (!ctx.activeOrganisation)
          throw new Error("Choose a company before controlling its CRM workspace.");
        return releaseAiControl(
          input.viewerSessionId,
          ctx.activeOrganisation.organisationId,
          ctx.user.id
        );
      }),
    askAssistant: secondFactorProcedure
      .input(z.object({ viewerSessionId: z.string().uuid(), command: z.string().trim().min(2).max(4_000) }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.activeOrganisation)
          throw new Error("Choose a company before asking about this CRM workspace.");
        const pageContext = await getSanitisedLiveCrmContext({
          viewerSessionId: input.viewerSessionId,
          organisationId: ctx.activeOrganisation.organisationId,
          userId: ctx.user.id,
        });
        const prepared = await prepareGovernedAssistantRequest({
          userId: ctx.user.id,
          organisationId: ctx.activeOrganisation.organisationId,
          command: input.command,
          crmContext: pageContext,
        });
        return { ...prepared, pageContext };
      }),
  }),
  knowledge: router({
    list: secondFactorProcedure.query(({ ctx }) => {
      if (!ctx.activeOrganisation)
        throw new Error("Choose an organisation before accessing knowledge.");
      return listKnowledgeSources(
        ctx.user.id,
        ctx.activeOrganisation.organisationId
      );
    }),
    add: secondFactorProcedure
      .input(
        z.object({
          title: z.string().trim().min(2).max(220),
          sourceType: z.enum(["note", "url", "document"]),
          sourceUrl: z.string().url().max(1024).optional(),
          content: z.string().trim().max(40_000).optional(),
        })
      )
      .mutation(({ ctx, input }) => {
        if (!ctx.activeOrganisation)
          throw new Error("Choose an organisation before adding knowledge.");
        return createKnowledgeSource({
          userId: ctx.user.id,
          organisationId: ctx.activeOrganisation.organisationId,
          ...input,
        });
      }),
  }),
  companySetup: router({
    get: secondFactorProcedure.query(({ ctx }) => {
      if (!ctx.activeOrganisation)
        throw new Error(
          "Choose an organisation before accessing company setup."
        );
      return getCompanySetup(
        ctx.user.id,
        ctx.activeOrganisation.organisationId
      );
    }),
    saveProfile: secondFactorProcedure
      .input(
        z.object({
          companyName: z.string().trim().min(2).max(220),
          websiteUrl: z.string().url().max(1024).optional().nullable(),
          industry: z.string().trim().max(180).optional().nullable(),
          companySize: z.string().trim().max(80).optional().nullable(),
          primaryMarket: z.string().trim().max(220).optional().nullable(),
          salesMotion: z.string().trim().max(180).optional().nullable(),
          productsServices: z.string().trim().max(8_000).optional().nullable(),
          typicalCustomer: z.string().trim().max(8_000).optional().nullable(),
          primarySalesObjective: z
            .string()
            .trim()
            .max(500)
            .optional()
            .nullable(),
          brandVoice: z.string().trim().max(8_000).optional().nullable(),
        })
      )
      .mutation(({ ctx, input }) => {
        if (!ctx.activeOrganisation)
          throw new Error(
            "Choose an organisation before saving company setup."
          );
        return upsertCompanyProfile({
          userId: ctx.user.id,
          organisationId: ctx.activeOrganisation.organisationId,
          ...input,
        });
      }),
    discoverWebsite: secondFactorProcedure.mutation(async ({ ctx }) => {
      if (!ctx.activeOrganisation)
        throw new Error("Choose an organisation before discovering a website.");
      const setup = await getCompanySetup(
        ctx.user.id,
        ctx.activeOrganisation.organisationId
      );
      if (!setup.profile?.websiteUrl)
        throw new Error(
          "Save a public company website before starting discovery."
        );
      const canonical = await discoverAndReviewCompanyIntelligence({
        userId: ctx.user.id,
        organisationId: ctx.activeOrganisation.organisationId,
        websiteUrl: setup.profile.websiteUrl,
        reference: `website-review:${setup.profile.id}:${Date.now()}`,
      });
      const { discovery, proposedKnowledge, reviewState, reviewUnavailable, aiReview } = canonical;
      const discoveryId = await saveWebsiteDiscoveryReview({
        userId: ctx.user.id,
        organisationId: ctx.activeOrganisation.organisationId,
        companyProfileId: setup.profile.id,
        sourceUrl: discovery.sourceUrl,
        pageTitle: discovery.pageTitle,
        extractedText: discovery.extractedText,
        proposedFacts: {
          ...discovery.proposedFacts,
          pages: discovery.pages,
          companyIntelligenceReview: {
            agentKey: "company_intelligence_review",
            state: reviewState,
            unavailableReason: reviewUnavailable || null,
            review: aiReview,
          },
        },
        proposedKnowledge,
        reviewAgentKey: "company_intelligence_review",
        reviewState,
      });
      return { ...discovery, proposedKnowledge, discoveryId, reviewState, reviewUnavailable };
    }),
    confirmDiscovery: managementProcedure
      .input(
        z.object({
          discoveryId: z.number().int().positive(),
          knowledgeIndexes: z.array(z.number().int().min(0).max(79)).max(80),
          corrections: z
            .array(
              z.object({
                index: z.number().int().min(0).max(79),
                title: z.string().trim().min(1).max(220),
                content: z.string().trim().min(1).max(40_000),
              })
            )
            .max(80)
            .optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (!ctx.activeOrganisation)
          throw new Error(
            "Choose an organisation before confirming website knowledge."
          );
        const setup = await getCompanySetup(
          ctx.user.id,
          ctx.activeOrganisation.organisationId
        );
        if (!setup.profile?.websiteUrl)
          throw new Error(
            "Save a public company website before confirming discovery."
          );
        return confirmWebsiteDiscovery({
          userId: ctx.user.id,
          organisationId: ctx.activeOrganisation.organisationId,
          companyProfileId: setup.profile.id,
          discoveryId: input.discoveryId,
          knowledgeIndexes: input.knowledgeIndexes,
          corrections: input.corrections,
        });
      }),
    savePlaybook: secondFactorProcedure
      .input(
        z.object({
          title: z.string().trim().min(2).max(220),
          trigger: z.string().trim().min(2).max(160),
          description: z.string().trim().min(5).max(8_000),
          agentKey: z.string().trim().min(2).max(80),
          requiredCapabilities: z
            .array(z.string().trim().min(2).max(80))
            .min(1)
            .max(12),
          status: z.enum(["draft", "active", "paused"]),
        })
      )
      .mutation(({ ctx, input }) => {
        if (!ctx.activeOrganisation)
          throw new Error("Choose an organisation before saving a playbook.");
        return saveAutomationPlaybook({
          userId: ctx.user.id,
          organisationId: ctx.activeOrganisation.organisationId,
          ...input,
        });
      }),
  }),
  calls: router({
    startFromToday: secondFactorProcedure
      .input(
        z.object({
          opportunityId: z.number().int().positive(),
          callingMode: z.enum(["genie", "external"]).default("external"),
        })
      )
      .mutation(({ ctx, input }) => {
        if (!ctx.activeOrganisation)
          throw new Error(
            "Choose an organisation before starting a live call."
          );
        return startLiveCallFromToday({
          userId: ctx.user.id,
          organisationId: ctx.activeOrganisation.organisationId,
          opportunityId: input.opportunityId,
          callingMode: input.callingMode,
        });
      }),
    searchContacts: secondFactorProcedure
      .input(z.object({ query: z.string().trim().min(2).max(320) }))
      .query(({ ctx, input }) => {
        if (!ctx.activeOrganisation)
          throw new Error(
            "Choose an organisation before resolving a CRM contact."
          );
        return searchLiveCallContacts({
          organisationId: ctx.activeOrganisation.organisationId,
          query: input.query,
        });
      }),
    context: secondFactorProcedure
      .input(z.object({ callSessionId: z.number().int().positive() }))
      .query(({ ctx, input }) => {
        if (!ctx.activeOrganisation)
          throw new Error("Choose an organisation before opening a live call.");
        return getLiveCallContext({
          userId: ctx.user.id,
          organisationId: ctx.activeOrganisation.organisationId,
          callSessionId: input.callSessionId,
        });
      }),
    saveNotes: secondFactorProcedure
      .input(
        z.object({
          leadLabel: z.string().trim().min(1).max(160),
          transcript: z.string().trim().max(40_000).optional(),
          coachNotes: z.string().trim().max(12_000).optional(),
        })
      )
      .mutation(({ ctx, input }) => {
        if (!ctx.activeOrganisation)
          throw new Error("Choose an organisation before saving call notes.");
        return createCallSession({
          userId: ctx.user.id,
          organisationId: ctx.activeOrganisation.organisationId,
          ...input,
        });
      }),
    startLive: secondFactorProcedure
      .input(
        z.object({
          leadLabel: z.string().trim().min(1).max(160),
          contactId: z.number().int().positive().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (!ctx.activeOrganisation)
          throw new Error(
            "Choose an organisation before starting a live call."
          );
        if (input.contactId)
          return startLiveCallForContact({
            userId: ctx.user.id,
            organisationId: ctx.activeOrganisation.organisationId,
            contactId: input.contactId,
          });
        const callSessionId = await createLiveCallSession({
          userId: ctx.user.id,
          organisationId: ctx.activeOrganisation.organisationId,
          leadLabel: input.leadLabel,
        });
        return { callSessionId, leadLabel: input.leadLabel };
      }),
    coachTranscript: secondFactorProcedure
      .input(
        z.object({
          callSessionId: z.number().int().positive(),
          leadLabel: z.string().trim().min(1).max(160),
          transcriptChunk: z.string().trim().min(4).max(12_000),
          approvedContext: z.string().trim().max(8_000).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const tip = await prepareLiveCoachingTip({
          leadLabel: input.leadLabel,
          transcript: input.transcriptChunk,
          approvedContext: input.approvedContext,
        });
        if (!ctx.activeOrganisation)
          throw new Error(
            "Choose an organisation before updating a live call."
          );
        await appendLiveTranscript({
          userId: ctx.user.id,
          organisationId: ctx.activeOrganisation.organisationId,
          callSessionId: input.callSessionId,
          transcriptChunk: input.transcriptChunk,
          coachTip: tip.content,
        });
        return tip;
      }),
    completeLive: secondFactorProcedure
      .input(
        z.object({
          callSessionId: z.number().int().positive(),
          leadLabel: z.string().trim().min(1).max(160),
          transcript: z.string().trim().min(4).max(40_000),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const summary = await preparePostCallSummary({
          leadLabel: input.leadLabel,
          transcript: input.transcript,
        });
        if (!ctx.activeOrganisation)
          throw new Error(
            "Choose an organisation before completing a live call."
          );
        await appendLiveTranscript({
          userId: ctx.user.id,
          organisationId: ctx.activeOrganisation.organisationId,
          callSessionId: input.callSessionId,
          transcriptChunk: input.transcript,
        });
        await completeLiveCallSession({
          userId: ctx.user.id,
          organisationId: ctx.activeOrganisation.organisationId,
          callSessionId: input.callSessionId,
          summary: summary.content,
        });
        return summary;
      }),
  }),
  analytics: router({
    summary: secondFactorProcedure.query(({ ctx }) => {
      if (!ctx.activeOrganisation)
        throw new Error("Choose an organisation before accessing analytics.");
      return getOperationalAnalytics(
        ctx.user.id,
        ctx.activeOrganisation.organisationId
      );
    }),
    audit: secondFactorProcedure
      .input(
        z
          .object({ limit: z.number().int().min(1).max(100).optional() })
          .optional()
      )
      .query(({ ctx, input }) => {
        if (!ctx.activeOrganisation)
          throw new Error("Choose an organisation before accessing audit.");
        return listAuditEntries(
          ctx.user.id,
          ctx.activeOrganisation.organisationId,
          input?.limit ?? 60
        );
      }),
  }),
  outlook: router({
    readiness: secondFactorProcedure.query(() => getOutlookReadiness()),
    previewEmail: secondFactorProcedure
      .input(
        z.object({
          to: z.string().max(320),
          subject: z.string().max(300),
          body: z.string().max(20_000),
          templateName: z.string().max(200).optional(),
        })
      )
      .mutation(({ input }) => validateEmailPreview(input)),
  }),
  reports: router({
    list: secondFactorProcedure.query(({ ctx }) => {
      if (!ctx.activeOrganisation)
        throw new Error("Choose an organisation before accessing reports.");
      return listDailyReports(
        ctx.user.id,
        ctx.activeOrganisation.organisationId
      );
    }),
    configureDaily: secondFactorProcedure
      .input(
        z.object({
          recipientEmail: z.string().email(),
          cronExpression: z
            .string()
            .regex(
              /^\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+$/,
              "Use a six-field UTC cron expression."
            ),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (!getSmtpReadiness().ready)
          throw new Error(
            "Configure SMTP deployment secrets before scheduling a daily report."
          );
        const sessionToken =
          parseCookieHeader(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? "";
        if (!ctx.activeOrganisation)
          throw new Error("Choose an organisation before scheduling reports.");
        const reportId = await createDailyReport({
          userId: ctx.user.id,
          organisationId: ctx.activeOrganisation.organisationId,
          ...input,
        });
        const job = await createHeartbeatJob(
          {
            name: `amarktai-daily-report-${reportId}`,
            cron: input.cronExpression,
            path: "/api/scheduled/daily-report",
            payload: { reportId },
            description: `Daily Amarktai workspace report for ${input.recipientEmail}`,
          },
          sessionToken
        );
        await attachDailyReportTask({
          reportId,
          userId: ctx.user.id,
          organisationId: ctx.activeOrganisation.organisationId,
          taskUid: job.taskUid,
        });
        return { reportId, nextExecutionAt: job.nextExecutionAt ?? null };
      }),
  }),
});

export type AppRouter = typeof appRouter;
