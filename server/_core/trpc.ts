import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { assertManagementElevation } from "../managementElevation";
import { recordAudit } from "../db";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const secondFactorProcedure = protectedProcedure.use(async opts => {
  if (!opts.ctx.twoFactorVerified) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Two-factor verification is required for this workspace action." });
  }
  return opts.next();
});

export const managementProcedure = secondFactorProcedure.use(async opts => {
  if (!opts.ctx.activeOrganisation) throw new TRPCError({ code: "FORBIDDEN", message: "Choose an organisation before entering management mode." });
  if (opts.ctx.managementElevationStatus === "expired") await recordAudit({ userId: opts.ctx.user.id, organisationId: opts.ctx.activeOrganisation.organisationId, eventType: "management_elevation_expired", entityType: "user", entityId: String(opts.ctx.user.id), summary: "A sensitive management request was denied because elevation expired.", metadata: {} }).catch(() => undefined);
  try {
    assertManagementElevation({ role: opts.ctx.activeOrganisation.role, isPlatformOwner: opts.ctx.user.isPlatformOwner, status: opts.ctx.managementElevationStatus });
  } catch (error) {
    throw new TRPCError({ code: "FORBIDDEN", message: error instanceof Error ? error.message : "MANAGEMENT_ELEVATION_REQUIRED" });
  }
  return opts.next();
});

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
