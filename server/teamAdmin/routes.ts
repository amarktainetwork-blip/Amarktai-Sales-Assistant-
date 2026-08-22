import type { Express, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { jwtVerify, SignJWT } from "jose";
import { COOKIE_NAME } from "@shared/const";
import { connectedSystems, externalUserMappings, organisationMembers, users } from "../../drizzle/schema";
import { getDb, getUserByEmail, getUserById, recordAudit } from "../db";
import { isLocalAuthMode } from "../localAuth";
import { canManageOrganisation } from "../organisationAccess";
import { getSmtpReadiness, sendEmail } from "../smtp";
import { requireLocalHttpContext } from "../httpAuth";

const INVITE_TTL_SECONDS = 48 * 60 * 60;
type ManagedRole = "manager" | "salesperson" | "auditor";
type Authenticated = { id: number };

function inviteKey() {
  const secret = process.env.SECRET_KEY || process.env.JWT_SECRET;
  if (!secret) throw new Error("SECRET_KEY is required for team invitations.");
  return new TextEncoder().encode(secret);
}

async function requireManager(req: Request) {
  const { userId, membership } = await requireLocalHttpContext(req);
  if (!canManageOrganisation(membership.role)) throw new Error("MANAGER_REQUIRED");
  return { user: { id: userId } as Authenticated, membership };
}

async function listMembers(organisationId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  return db.select({
    memberId: organisationMembers.id,
    userId: users.id,
    name: users.name,
    email: users.email,
    role: organisationMembers.role,
    isActive: organisationMembers.isActive,
    hasPassword: users.passwordHash,
    createdAt: organisationMembers.createdAt,
  }).from(organisationMembers).innerJoin(users, eq(users.id, organisationMembers.userId)).where(eq(organisationMembers.organisationId, organisationId));
}

function cleanRole(value: unknown): ManagedRole {
  if (value === "manager" || value === "salesperson" || value === "auditor") return value;
  throw new Error("A valid organisation role is required.");
}

async function issueInvite(input: { userId: number; organisationId: number; email: string }) {
  return new SignJWT({ type: "amarktai_team_invite", organisationId: input.organisationId, email: input.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(input.userId))
    .setIssuedAt()
    .setExpirationTime(`${INVITE_TTL_SECONDS}s`)
    .sign(inviteKey());
}

async function sendInviteEmail(input: { to: string; name: string; organisationName: string; token: string }) {
  if (!getSmtpReadiness().ready) throw new Error("SMTP is required before team invitations can be sent.");
  const appUrl = process.env.APP_PUBLIC_URL?.replace(/\/$/, "");
  if (!appUrl) throw new Error("APP_PUBLIC_URL is required before team invitations can be sent.");
  const link = `${appUrl}/auth?invite=${encodeURIComponent(input.token)}`;
  await sendEmail({
    to: input.to,
    subject: `You've been invited to ${input.organisationName} on Amarktai`,
    text: `${input.name || "Hello"},\n\nYou have been invited to ${input.organisationName} on Amarktai Sales Assistant. Set your password using this one-time setup link within 48 hours:\n\n${link}\n\nIf you were not expecting this invitation, ignore this email.`,
    html: `<main style="font-family:Arial,sans-serif;color:#102238;max-width:600px;margin:auto"><p style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#1b64f2">Amarktai Sales Assistant</p><h1>Join ${input.organisationName}</h1><p>${input.name || "Hello"}, your management team has invited you to the protected Amarktai sales workspace.</p><p><a href="${link}" style="display:inline-block;background:#1b64f2;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">Set password & activate access</a></p><p>This setup link expires in 48 hours and cannot be used again after a password is set.</p></main>`,
  });
}

function sendError(res: Response, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  if (detail === "AUTH_REQUIRED") return res.status(401).json({ error: "Authentication is required." });
  if (detail === "TWO_FACTOR_REQUIRED") return res.status(403).json({ error: "Second-factor verification is required." });
  if (detail === "MANAGER_REQUIRED") return res.status(403).json({ error: "A management role is required." });
  console.error(JSON.stringify({ event: "team_admin_error", detail: detail.slice(0, 300) }));
  return res.status(400).json({ error: detail.slice(0, 300) || "Team operation failed." });
}

export function registerTeamAdminRoutes(app: Express) {
  app.get("/api/team-admin/members", async (req, res) => {
    try {
      const { membership } = await requireManager(req);
      const members = await listMembers(membership.organisationId);
      return res.json({ organisation: { id: membership.organisationId, name: membership.organisationName, role: membership.role }, members: members.map(member => ({ ...member, hasPassword: Boolean(member.hasPassword) })) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.get("/api/team-admin/crm-owner-mappings", async (req, res) => {
    try {
      const { membership } = await requireManager(req);
      const connectedSystemId = req.query.connectedSystemId === undefined ? undefined : Number(req.query.connectedSystemId);
      if (connectedSystemId !== undefined && (!Number.isInteger(connectedSystemId) || connectedSystemId <= 0)) throw new Error("A valid connected system is required.");
      const db = await getDb();
      if (!db) throw new Error("Database connection is unavailable.");
      const predicates = [eq(externalUserMappings.organisationId, membership.organisationId)];
      if (connectedSystemId) predicates.push(eq(externalUserMappings.connectedSystemId, connectedSystemId));
      const mappings = await db.select({ id: externalUserMappings.id, connectedSystemId: externalUserMappings.connectedSystemId, externalUserId: externalUserMappings.externalUserId, displayName: externalUserMappings.displayName, email: externalUserMappings.email, isActive: externalUserMappings.isActive, userId: externalUserMappings.userId, memberName: users.name, memberEmail: users.email }).from(externalUserMappings).leftJoin(users, eq(users.id, externalUserMappings.userId)).where(and(...predicates));
      return res.json({ mappings });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.put("/api/team-admin/crm-owner-mappings", async (req, res) => {
    try {
      const { user: actor, membership } = await requireManager(req);
      const connectedSystemId = Number(req.body?.connectedSystemId);
      const externalUserId = typeof req.body?.externalUserId === "string" ? req.body.externalUserId.trim().slice(0, 180) : "";
      const displayName = typeof req.body?.displayName === "string" ? req.body.displayName.trim().slice(0, 220) : "";
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase().slice(0, 320) || null : null;
      const userId = req.body?.userId === null || req.body?.userId === undefined || req.body?.userId === "" ? null : Number(req.body.userId);
      const isActive = req.body?.isActive === undefined ? true : Boolean(req.body.isActive);
      if (!Number.isInteger(connectedSystemId) || connectedSystemId <= 0) throw new Error("A valid connected system is required.");
      if (!externalUserId || !displayName) throw new Error("External owner ID and display name are required.");
      if (userId !== null && (!Number.isInteger(userId) || userId <= 0)) throw new Error("A valid Amarktai team member is required.");
      const db = await getDb();
      if (!db) throw new Error("Database connection is unavailable.");
      const system = (await db.select({ id: connectedSystems.id }).from(connectedSystems).where(and(eq(connectedSystems.id, connectedSystemId), eq(connectedSystems.organisationId, membership.organisationId))).limit(1))[0];
      if (!system) throw new Error("Connected system was not found in the active organisation.");
      if (userId !== null) {
        const member = (await db.select({ id: organisationMembers.id }).from(organisationMembers).where(and(eq(organisationMembers.organisationId, membership.organisationId), eq(organisationMembers.userId, userId), eq(organisationMembers.isActive, true))).limit(1))[0];
        if (!member) throw new Error("Mapped Amarktai member must be active in the organisation.");
      }
      await db.insert(externalUserMappings).values({ organisationId: membership.organisationId, connectedSystemId, userId, externalUserId, displayName, email, isActive }).onDuplicateKeyUpdate({ set: { userId, displayName, email, isActive } });
      await recordAudit({ userId: actor.id, eventType: "crm_owner_mapping_saved", entityType: "external_user_mapping", entityId: `${connectedSystemId}:${externalUserId}`, summary: `CRM owner '${displayName}' mapping was saved.`, metadata: { organisationId: membership.organisationId, connectedSystemId, externalUserId, mappedUserId: userId, isActive } });
      return res.json({ ok: true });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/team-admin/invite", async (req, res) => {
    try {
      if (!isLocalAuthMode()) throw new Error("Self-hosted team invitations are available in local authentication mode.");
      const { user: actor, membership } = await requireManager(req);
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 160) : "";
      const role = cleanRole(req.body?.role);
      if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error("A valid email address is required.");
      if (!name) throw new Error("The salesperson/member name is required.");
      if (membership.role === "manager" && role === "manager") throw new Error("Only an organisation owner can invite another manager.");
      const db = await getDb();
      if (!db) throw new Error("Database connection is unavailable.");

      let invited = await getUserByEmail(email);
      if (!invited) {
        const inserted = await db.insert(users).values({ openId: `local-invite:${randomUUID()}`, name, email, loginMethod: "local", passwordHash: null, role: "user" });
        invited = await getUserById(Number(inserted[0].insertId));
      }
      if (!invited) throw new Error("The invited user could not be created.");
      await db.insert(organisationMembers).values({ organisationId: membership.organisationId, userId: invited.id, role, isActive: true }).onDuplicateKeyUpdate({ set: { role, isActive: true } });

      let emailState: "invite_sent" | "existing_account_notified";
      if (!invited.passwordHash) {
        const token = await issueInvite({ userId: invited.id, organisationId: membership.organisationId, email });
        await sendInviteEmail({ to: email, name, organisationName: membership.organisationName, token });
        emailState = "invite_sent";
      } else {
        await sendEmail({ to: email, subject: `You've been added to ${membership.organisationName} on Amarktai`, text: `You have been added to ${membership.organisationName} on Amarktai. Sign in with your existing Amarktai credentials.`, html: `<main style="font-family:Arial,sans-serif;color:#102238"><h1>You've been added to ${membership.organisationName}</h1><p>Sign in with your existing Amarktai credentials.</p></main>` });
        emailState = "existing_account_notified";
      }
      await recordAudit({ userId: actor.id, eventType: "organisation_member_invited", entityType: "organisation_member", entityId: String(invited.id), summary: `${email} was added to the organisation as ${role}.`, metadata: { organisationId: membership.organisationId, role, emailState } });
      return res.json({ ok: true, emailState });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.patch("/api/team-admin/members/:memberId", async (req, res) => {
    try {
      const { user: actor, membership } = await requireManager(req);
      const memberId = Number(req.params.memberId);
      if (!Number.isInteger(memberId) || memberId <= 0) throw new Error("A valid organisation member is required.");
      const db = await getDb();
      if (!db) throw new Error("Database connection is unavailable.");
      const current = (await db.select().from(organisationMembers).where(and(eq(organisationMembers.id, memberId), eq(organisationMembers.organisationId, membership.organisationId))).limit(1))[0];
      if (!current) throw new Error("Organisation member was not found.");
      if (current.role === "owner") throw new Error("The organisation owner cannot be changed from this screen.");
      if (current.userId === actor.id && req.body?.isActive === false) throw new Error("You cannot deactivate your own management membership.");
      const patch: Partial<typeof organisationMembers.$inferInsert> = {};
      if (req.body?.role !== undefined) {
        const role = cleanRole(req.body.role);
        if (membership.role === "manager" && role === "manager") throw new Error("Only an organisation owner can assign the manager role.");
        patch.role = role;
      }
      if (typeof req.body?.isActive === "boolean") patch.isActive = req.body.isActive;
      if (!Object.keys(patch).length) throw new Error("No member change was supplied.");
      await db.update(organisationMembers).set(patch).where(eq(organisationMembers.id, memberId));
      await recordAudit({ userId: actor.id, eventType: "organisation_member_updated", entityType: "organisation_member", entityId: String(memberId), summary: "Organisation member access was updated.", metadata: { organisationId: membership.organisationId, role: patch.role, isActive: patch.isActive } });
      return res.json({ ok: true });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/team-admin/accept-invite", async (req, res) => {
    try {
      if (!isLocalAuthMode()) throw new Error("This invitation cannot be accepted in the current authentication mode.");
      const token = typeof req.body?.token === "string" ? req.body.token : "";
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      if (password.length < 12) throw new Error("Choose a password with at least 12 characters.");
      const { payload } = await jwtVerify(token, inviteKey());
      if (payload.type !== "amarktai_team_invite" || !payload.sub || typeof payload.organisationId !== "number" || typeof payload.email !== "string") throw new Error("This invitation is invalid.");
      const userId = Number(payload.sub);
      const db = await getDb();
      if (!db) throw new Error("Database connection is unavailable.");
      const user = await getUserById(userId);
      if (!user || user.email?.toLowerCase() !== payload.email.toLowerCase()) throw new Error("This invitation no longer matches an account.");
      if (user.passwordHash) throw new Error("This invitation has already been used. Sign in with your existing password.");
      const membership = (await db.select().from(organisationMembers).where(and(eq(organisationMembers.organisationId, payload.organisationId), eq(organisationMembers.userId, userId), eq(organisationMembers.isActive, true))).limit(1))[0];
      if (!membership) throw new Error("This invitation is no longer active.");
      const passwordHash = await bcrypt.hash(password, 12);
      await db.update(users).set({ passwordHash, loginMethod: "local" }).where(and(eq(users.id, userId), eq(users.email, payload.email)));
      return res.json({ ok: true, email: user.email });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return res.status(400).json({ error: /JWT|expired|signature/i.test(detail) ? "This invitation is invalid or expired. Ask management to send a new one." : detail.slice(0, 300) });
    }
  });
}
