import { z } from "zod";
import { parse as parseCookieHeader } from "cookie";
import { AGENT_CATALOG, WORKFLOW_KEYS } from "./agentCatalog";
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
  getOperationsDashboard,
  getOperationalAnalytics,
  getApprovedActionProposal,
  recordActionExecution,
  attachDailyReportTask,
  consumeValidTwoFactorChallenge,
  listDailyReports,
  listActionProposals,
  listIntegrationProfiles,
  listKnowledgeSources,
  searchApprovedKnowledge,
  listAuditEntries,
  listProposalAuditEntries,
  reviewActionProposal,
  saveAutomationPlaybook,
  saveCrmConnection,
  upsertCompanyProfile,
  appendLiveTranscript,
  completeLiveCallSession,
} from "./db";
import { getGenxReadiness, runGenxAgent } from "./genx";
import { getGenieReadiness } from "./genie/config";
import { executeApprovedGenieProposal } from "./genie/executeProposal";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router, secondFactorProcedure } from "./_core/trpc";
import { buildWorkflowPlan } from "./workflowRules";
import { compareVerificationCode, createVerificationChallenge, issueTwoFactorSession, TWO_FACTOR_COOKIE, TWO_FACTOR_MAX_AGE_MS } from "./twoFactor";
import { getSmtpReadiness, sendSecondFactorCode } from "./smtp";
import { createHeartbeatJob } from "./_core/heartbeat";
import { authenticateLocalPassword, isLocalAuthMode, issueLocalSession, LOCAL_SESSION_MAX_AGE_MS } from "./localAuth";
import { routeSalesCommand } from "./supervisor";
import { prepareLiveCoachingTip, preparePostCallSummary } from "./liveCoach";
import { getOutlookReadiness, validateEmailPreview } from "./outlook";
import { discoverPublicWebsite } from "./companyDiscovery";
import { routeWorkflowActions } from "./crmRouter";

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

function presentConnectionProfile<T extends { provider: keyof typeof publicConnectionLabels; displayName: string; scopeSummary: string | null }>(profile: T) {
  const productLabel = publicConnectionLabels[profile.provider];
  return {
    ...profile,
    displayName: productLabel,
    scopeSummary: `Amarktai Network ${productLabel.toLowerCase()} profile. Technical configuration details remain server-side.`,
  };
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    mode: publicProcedure.query(() => ({ local: isLocalAuthMode() })),
    localLogin: publicProcedure.input(z.object({ email: z.string().email(), password: z.string().min(12).max(160) })).mutation(async ({ ctx, input }) => {
      if (!isLocalAuthMode()) throw new Error("Local login is only available on the self-hosted Webdock deployment.");
      const user = await authenticateLocalPassword(input.email, input.password);
      if (!user) throw new Error("Invalid email or password.");
      const token = await issueLocalSession(user);
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: LOCAL_SESSION_MAX_AGE_MS });
      return { success: true };
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
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
      if (!ctx.user.email) throw new Error("Your account has no email address. Add one to the self-hosted administrator configuration before enabling workspace access.");
      if (!getSmtpReadiness().ready) throw new Error("Email verification is not configured yet. Add the SMTP deployment secrets before enabling two-factor access.");
      const challenge = createVerificationChallenge(ctx.user.id);
      await createTwoFactorChallenge({ userId: ctx.user.id, codeHash: challenge.codeHash, expiresAt: challenge.expiresAt });
      await sendSecondFactorCode({ to: ctx.user.email, code: challenge.code });
      return { success: true };
    }),
    verifyEmailCode: protectedProcedure.input(z.object({ code: z.string().regex(/^\d{6}$/) })).mutation(async ({ ctx, input }) => {
      const valid = await consumeValidTwoFactorChallenge({ userId: ctx.user.id, isValid: hash => compareVerificationCode(ctx.user.id, input.code, hash) });
      if (!valid) throw new Error("That verification code is invalid, expired, or has reached its attempt limit.");
      const token = await issueTwoFactorSession(ctx.user.id);
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(TWO_FACTOR_COOKIE, token, { ...cookieOptions, maxAge: TWO_FACTOR_MAX_AGE_MS });
      return { success: true };
    }),
  }),
  assistant: router({
    dashboard: secondFactorProcedure.query(({ ctx }) => getAssistantDashboard(ctx.user.id)),
    operationsDashboard: secondFactorProcedure.query(async ({ ctx }) => {
      const dashboard = await getOperationsDashboard(ctx.user.id);
      return {
        ...dashboard,
        connectionReadiness: {
          crmBrowserBridge: getGenieReadiness().configured,
          microsoftConnection: getOutlookReadiness().ready,
          intelligenceService: getGenxReadiness().ready,
          emailDelivery: getSmtpReadiness().ready,
        },
      };
    }),
    routeCommand: secondFactorProcedure.input(z.object({ command: z.string().trim().min(4).max(4_000) })).mutation(({ input }) => routeSalesCommand(input.command)),
    agents: secondFactorProcedure.query(() => ({ agents: AGENT_CATALOG, genx: getGenxReadiness() })),
    actions: secondFactorProcedure
      .input(z.object({ workflowRunId: z.number().int().positive().optional() }).optional())
      .query(({ ctx, input }) => listActionProposals(ctx.user.id, input?.workflowRunId)),
    prepareWorkflow: secondFactorProcedure.input(workflowInput).mutation(async ({ ctx, input }) => {
      const plan = buildWorkflowPlan(input);
      const companySetup = await getCompanySetup(ctx.user.id);
      const routedActions = routeWorkflowActions(plan.actions, companySetup.connections);
      const workflowRunId = await createWorkflowRun({
        userId: ctx.user.id,
        workflowKey: input.workflowKey,
        leadLabel: input.leadLabel,
        payload: input,
        verificationSummary: plan.verificationSummary,
        actions: routedActions,
      });
      return { workflowRunId, verificationSummary: plan.verificationSummary, actionCount: routedActions.length, blockedActionCount: routedActions.filter(action => (action.payload.crmRoute as { routable?: boolean } | undefined)?.routable === false).length };
    }),
    reviewAction: secondFactorProcedure
      .input(z.object({ proposalId: z.number().int().positive(), state: z.enum(["approved", "skipped"]) }))
      .mutation(async ({ ctx, input }) => {
        await reviewActionProposal(ctx.user.id, input.proposalId, input.state);
        return { success: true };
      }),
    proposalAudit: secondFactorProcedure.input(z.object({ proposalId: z.number().int().positive() })).query(({ ctx, input }) => listProposalAuditEntries(ctx.user.id, input.proposalId)),
    executeApprovedGenieAction: secondFactorProcedure.input(z.object({ proposalId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const proposal = await getApprovedActionProposal(ctx.user.id, input.proposalId);
      if (!proposal) throw new Error("Only an approved action proposal may be executed, and it must be owned by your workspace.");
      const crmRoute = proposal.payload.crmRoute as { routable?: boolean; provider?: string } | undefined;
      if (!crmRoute?.routable || crmRoute.provider !== "genie") throw new Error("This proposal has no ready CRM workspace bridge route. Register and verify a compatible CRM capability before requesting execution.");
      const result = await executeApprovedGenieProposal(proposal);
      await recordActionExecution({ userId: ctx.user.id, proposalId: proposal.id, success: result.success, result });
      if (!result.success) throw new Error(`Genie script failed: ${result.detail}`);
      return result;
    }),
    chat: secondFactorProcedure
      .input(
        z.object({
          agentKey: z.string().min(1).max(80),
          messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(12_000) })).min(1).max(18),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const query = input.messages.filter(message => message.role === "user").map(message => message.content).join("\n");
        const sources = input.agentKey === "knowledge_guide" ? await searchApprovedKnowledge(ctx.user.id, query) : [];
        const approvedKnowledge = sources.length ? sources.map(source => `[${source.title}]\n${source.content ?? source.sourceUrl ?? "No retained body."}`).join("\n\n---\n\n") : undefined;
        return runGenxAgent({ ...input, approvedKnowledge });
      }),
  }),
  integrations: router({
    list: secondFactorProcedure.query(async ({ ctx }) => ({
      profiles: (await listIntegrationProfiles(ctx.user.id)).map(presentConnectionProfile),
      genx: getGenxReadiness(),
      outlook: getOutlookReadiness(),
      genie: {
        ...getGenieReadiness(),
        requiredVariables: ["GENIE_LOGIN_URL", "GENIE_USERNAME", "GENIE_PASSWORD", "BROWSERLESS_WS_ENDPOINT"],
      },
    })),
    createProfile: secondFactorProcedure
      .input(z.object({ provider: z.enum(["genie", "outlook", "genx"]), displayName: z.string().trim().min(2).max(140), scopeSummary: z.string().trim().max(800).optional() }))
      .mutation(({ ctx, input }) => createIntegrationProfile({ userId: ctx.user.id, ...input })),
  }),
  knowledge: router({
    list: secondFactorProcedure.query(({ ctx }) => listKnowledgeSources(ctx.user.id)),
    add: secondFactorProcedure
      .input(z.object({ title: z.string().trim().min(2).max(220), sourceType: z.enum(["note", "url", "document"]), sourceUrl: z.string().url().max(1024).optional(), content: z.string().trim().max(40_000).optional() }))
      .mutation(({ ctx, input }) => createKnowledgeSource({ userId: ctx.user.id, ...input })),
  }),
  companySetup: router({
    get: secondFactorProcedure.query(({ ctx }) => getCompanySetup(ctx.user.id)),
    saveProfile: secondFactorProcedure.input(z.object({
      companyName: z.string().trim().min(2).max(220), websiteUrl: z.string().url().max(1024).optional().nullable(),
      industry: z.string().trim().max(180).optional().nullable(), companySize: z.string().trim().max(80).optional().nullable(),
      primaryMarket: z.string().trim().max(220).optional().nullable(), salesMotion: z.string().trim().max(180).optional().nullable(), brandVoice: z.string().trim().max(8_000).optional().nullable(),
    })).mutation(({ ctx, input }) => upsertCompanyProfile({ userId: ctx.user.id, ...input })),
    discoverWebsite: secondFactorProcedure.mutation(async ({ ctx }) => {
      const setup = await getCompanySetup(ctx.user.id);
      if (!setup.profile?.websiteUrl) throw new Error("Save a public company website before starting discovery.");
      return discoverPublicWebsite(setup.profile.websiteUrl);
    }),
    confirmDiscovery: secondFactorProcedure.input(z.object({ knowledgeIndexes: z.array(z.number().int().min(0).max(24)).max(12) })).mutation(async ({ ctx, input }) => {
      const setup = await getCompanySetup(ctx.user.id);
      if (!setup.profile?.websiteUrl) throw new Error("Save a public company website before confirming discovery.");
      const result = await discoverPublicWebsite(setup.profile.websiteUrl);
      const confirmedKnowledge = result.proposedKnowledge.filter((_, index) => input.knowledgeIndexes.includes(index));
      return confirmWebsiteDiscovery({ userId: ctx.user.id, companyProfileId: setup.profile.id, sourceUrl: result.sourceUrl, pageTitle: result.pageTitle, confirmedKnowledge });
    }),
    registerCrm: secondFactorProcedure.input(z.object({
      provider: z.enum(["genie", "hubspot", "salesforce", "pipedrive", "custom_browser"]), displayName: z.string().trim().min(2).max(180),
      status: z.enum(["draft", "needs_credentials", "ready", "paused", "error"]), capabilities: z.array(z.enum(["contacts", "tasks", "opportunities", "notes", "activities", "email", "calendar"])).min(1).max(7),
      connectionMode: z.enum(["api", "browser_automation", "custom"]), configurationHint: z.string().trim().max(2_000).optional().nullable(),
    })).mutation(({ ctx, input }) => saveCrmConnection({ userId: ctx.user.id, ...input })),
    savePlaybook: secondFactorProcedure.input(z.object({
      title: z.string().trim().min(2).max(220), trigger: z.string().trim().min(2).max(160), description: z.string().trim().min(5).max(8_000),
      agentKey: z.string().trim().min(2).max(80), requiredCapabilities: z.array(z.string().trim().min(2).max(80)).min(1).max(12), status: z.enum(["draft", "active", "paused"]),
    })).mutation(({ ctx, input }) => saveAutomationPlaybook({ userId: ctx.user.id, ...input })),
  }),
  calls: router({
    saveNotes: secondFactorProcedure
      .input(z.object({ leadLabel: z.string().trim().min(1).max(160), transcript: z.string().trim().max(40_000).optional(), coachNotes: z.string().trim().max(12_000).optional() }))
      .mutation(({ ctx, input }) => createCallSession({ userId: ctx.user.id, ...input })),
    startLive: secondFactorProcedure.input(z.object({ leadLabel: z.string().trim().min(1).max(160) })).mutation(({ ctx, input }) => createLiveCallSession({ userId: ctx.user.id, ...input })),
    coachTranscript: secondFactorProcedure.input(z.object({ callSessionId: z.number().int().positive(), leadLabel: z.string().trim().min(1).max(160), transcriptChunk: z.string().trim().min(4).max(12_000), approvedContext: z.string().trim().max(8_000).optional() })).mutation(async ({ ctx, input }) => {
      const tip = await prepareLiveCoachingTip({ leadLabel: input.leadLabel, transcript: input.transcriptChunk, approvedContext: input.approvedContext });
      await appendLiveTranscript({ userId: ctx.user.id, callSessionId: input.callSessionId, transcriptChunk: input.transcriptChunk, coachTip: tip.content });
      return tip;
    }),
    completeLive: secondFactorProcedure.input(z.object({ callSessionId: z.number().int().positive(), leadLabel: z.string().trim().min(1).max(160), transcript: z.string().trim().min(4).max(40_000) })).mutation(async ({ ctx, input }) => {
      const summary = await preparePostCallSummary({ leadLabel: input.leadLabel, transcript: input.transcript });
      await appendLiveTranscript({ userId: ctx.user.id, callSessionId: input.callSessionId, transcriptChunk: input.transcript });
      await completeLiveCallSession({ userId: ctx.user.id, callSessionId: input.callSessionId, summary: summary.content });
      return summary;
    }),
  }),
  analytics: router({
    summary: secondFactorProcedure.query(({ ctx }) => getOperationalAnalytics(ctx.user.id)),
    audit: secondFactorProcedure.input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional()).query(({ ctx, input }) => listAuditEntries(ctx.user.id, input?.limit ?? 60)),
  }),
  outlook: router({
    readiness: secondFactorProcedure.query(() => getOutlookReadiness()),
    previewEmail: secondFactorProcedure.input(z.object({ to: z.string().max(320), subject: z.string().max(300), body: z.string().max(20_000), templateName: z.string().max(200).optional() })).mutation(({ input }) => validateEmailPreview(input)),
  }),
  reports: router({
    list: secondFactorProcedure.query(({ ctx }) => listDailyReports(ctx.user.id)),
    configureDaily: secondFactorProcedure.input(z.object({ recipientEmail: z.string().email(), cronExpression: z.string().regex(/^\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+$/, "Use a six-field UTC cron expression.") })).mutation(async ({ ctx, input }) => {
      if (!getSmtpReadiness().ready) throw new Error("Configure SMTP deployment secrets before scheduling a daily report.");
      const sessionToken = parseCookieHeader(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? "";
      const reportId = await createDailyReport({ userId: ctx.user.id, ...input });
      const job = await createHeartbeatJob({ name: `amarktai-daily-report-${reportId}`, cron: input.cronExpression, path: "/api/scheduled/daily-report", payload: { reportId }, description: `Daily Amarktai workspace report for ${input.recipientEmail}` }, sessionToken);
      await attachDailyReportTask({ reportId, userId: ctx.user.id, taskUid: job.taskUid });
      return { reportId, nextExecutionAt: job.nextExecutionAt ?? null };
    }),
  }),
});

export type AppRouter = typeof appRouter;
