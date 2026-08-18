import { z } from "zod";
import { parse as parseCookieHeader } from "cookie";
import { AGENT_CATALOG, WORKFLOW_KEYS } from "./agentCatalog";
import {
  createCallSession,
  createDailyReport,
  createTwoFactorChallenge,
  createIntegrationProfile,
  createKnowledgeSource,
  createWorkflowRun,
  getAssistantDashboard,
  getApprovedActionProposal,
  recordActionExecution,
  attachDailyReportTask,
  consumeValidTwoFactorChallenge,
  listDailyReports,
  listActionProposals,
  listIntegrationProfiles,
  listKnowledgeSources,
  reviewActionProposal,
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

const workflowInput = z.object({
  workflowKey: z.enum(WORKFLOW_KEYS),
  leadLabel: z.string().trim().min(1).max(160),
  callOutcome: z.enum(["no_answer", "voicemail", "answered"]).optional(),
  conversationNotes: z.string().trim().max(12_000).optional(),
});

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
    agents: secondFactorProcedure.query(() => ({ agents: AGENT_CATALOG, genx: getGenxReadiness() })),
    actions: secondFactorProcedure
      .input(z.object({ workflowRunId: z.number().int().positive().optional() }).optional())
      .query(({ ctx, input }) => listActionProposals(ctx.user.id, input?.workflowRunId)),
    prepareWorkflow: secondFactorProcedure.input(workflowInput).mutation(async ({ ctx, input }) => {
      const plan = buildWorkflowPlan(input);
      const workflowRunId = await createWorkflowRun({
        userId: ctx.user.id,
        workflowKey: input.workflowKey,
        leadLabel: input.leadLabel,
        payload: input,
        verificationSummary: plan.verificationSummary,
        actions: plan.actions,
      });
      return { workflowRunId, verificationSummary: plan.verificationSummary, actionCount: plan.actions.length };
    }),
    reviewAction: secondFactorProcedure
      .input(z.object({ proposalId: z.number().int().positive(), state: z.enum(["approved", "skipped"]) }))
      .mutation(async ({ ctx, input }) => {
        await reviewActionProposal(ctx.user.id, input.proposalId, input.state);
        return { success: true };
      }),
    executeApprovedGenieAction: secondFactorProcedure.input(z.object({ proposalId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const proposal = await getApprovedActionProposal(ctx.user.id, input.proposalId);
      if (!proposal) throw new Error("Only an approved action proposal may be executed, and it must be owned by your workspace.");
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
      .mutation(({ input }) => runGenxAgent(input)),
  }),
  integrations: router({
    list: secondFactorProcedure.query(async ({ ctx }) => ({
      profiles: await listIntegrationProfiles(ctx.user.id),
      genx: getGenxReadiness(),
      outlook: {
        configured: Boolean(process.env.OUTLOOK_CLIENT_ID && process.env.OUTLOOK_CLIENT_SECRET && process.env.OUTLOOK_TENANT_ID),
        requiredVariables: ["OUTLOOK_CLIENT_ID", "OUTLOOK_CLIENT_SECRET", "OUTLOOK_TENANT_ID"],
      },
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
  calls: router({
    saveNotes: secondFactorProcedure
      .input(z.object({ leadLabel: z.string().trim().min(1).max(160), transcript: z.string().trim().max(40_000).optional(), coachNotes: z.string().trim().max(12_000).optional() }))
      .mutation(({ ctx, input }) => createCallSession({ userId: ctx.user.id, ...input })),
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
