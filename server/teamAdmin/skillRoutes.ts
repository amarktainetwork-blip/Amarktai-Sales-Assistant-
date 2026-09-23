import type { Express, Request, Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  approvalTemplates,
  playbookExecutionHistory,
  playbookVersions,
} from "../../drizzle/schema";
import {
  normalizeSkillDefinition,
  simulateSkillDefinition,
} from "../../shared/skillBuilder";
import {
  createWorkflowRun,
  getDb,
  listActionProposals,
  recordAudit,
} from "../db";
import { resolveAssistantCustomerContext } from "../assistantCustomerContext";
import { listConnectedSystemsForUser } from "../connectedSystems";
import { attachRuntimeOperationReadiness } from "../crm/runtimeCapabilities";
import { routeConnectedSystemActionsForUser } from "../crmRouter";
import { executeAutoPreapprovedActions } from "../governedActions";
import { getAutomationPolicy } from "../automationPolicy";
import { requireLocalHttpContext } from "../httpAuth";
import { buildSkillCapabilityPlan } from "../skillCapabilityPlan";
import { compileOrganisationSkill } from "../skillCompiler";
import {
  compileLearnedSkillRuntime,
  materializeLearnedSkillCommunications,
} from "../skillRuntime";
import { requireManagementHttpContext } from "../managementElevation";
import { canManageOrganisation } from "../organisationAccess";
import {
  syncTemplateCatalogue,
  templateCatalogueReadiness,
} from "../templateCatalogue";

function sendError(res: Response, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  const status = /REQUIRED|DENIED|MANAGER|not found/i.test(detail) ? 403 : 400;
  return res.status(status).json({ error: detail });
}

async function requireManager(req: Request) {
  const context = await requireManagementHttpContext(req);
  if (
    !context.user.isPlatformOwner &&
    !canManageOrganisation(context.membership.role)
  )
    throw new Error("MANAGER_REQUIRED");
  return context;
}

function safeKey(value: unknown) {
  return typeof value === "string"
    ? value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 140)
    : "";
}

async function scopedSkill(organisationId: number, id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const skill = (
    await db
      .select()
      .from(playbookVersions)
      .where(
        and(
          eq(playbookVersions.id, id),
          eq(playbookVersions.organisationId, organisationId)
        )
      )
      .limit(1)
  )[0];
  if (!skill)
    throw new Error("Skill version was not found in the active organisation.");
  return skill;
}

async function publishSkill(input: {
  organisationId: number;
  id: number;
  actorUserId: number;
  eventType: "skill_version_published" | "skill_version_rolled_back";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const skill = await scopedSkill(input.organisationId, input.id);
  const definition = normalizeSkillDefinition(skill.inputSchema);
  const simulation = simulateSkillDefinition(definition);
  const requiresWrite =
    definition.requiredWriteCapabilities.length > 0 ||
    definition.requiredOperations.some(operation =>
      operation.startsWith("custom.write.")
    );
  if (
    requiresWrite &&
    definition.writeApproval.status !== "approved_for_commissioning"
  )
    throw new Error(
      "WRITE_APPROVAL_REQUIRED: review and approve the exact CRM writes required by this skill before publishing it."
    );
  if (requiresWrite) {
    const connectedSystemId = definition.writeApproval.connectedSystemId;
    if (!connectedSystemId)
      throw new Error(
        "WRITE_COMMISSIONING_REQUIRED: choose the exact CRM connection for this skill before publication."
      );
    const plan = await buildSkillCapabilityPlan({
      organisationId: input.organisationId,
      connectedSystemId,
      definition,
    });
    if (!plan.canExecuteWrites)
      throw new Error(
        "WRITE_COMMISSIONING_REQUIRED: the approved write plan is not fully commissioned and LIVE_PROVEN yet."
      );
  }
  if (!simulation.valid)
    throw new Error(
      "SKILL_SIMULATION_REQUIRED: this version must pass every simulation check before publication."
    );
  await db.transaction(async tx => {
    await tx
      .update(playbookVersions)
      .set({ status: "archived" })
      .where(
        and(
          eq(playbookVersions.organisationId, input.organisationId),
          eq(playbookVersions.playbookKey, skill.playbookKey),
          eq(playbookVersions.status, "published")
        )
      );
    await tx
      .update(playbookVersions)
      .set({
        status: "published",
        publishedByUserId: input.actorUserId,
        publishedAt: new Date(),
      })
      .where(
        and(
          eq(playbookVersions.id, skill.id),
          eq(playbookVersions.organisationId, input.organisationId)
        )
      );
  });
  await recordAudit({
    userId: input.actorUserId,
    eventType: input.eventType,
    entityType: "playbook_version",
    entityId: String(skill.id),
    summary:
      input.eventType === "skill_version_rolled_back"
        ? `Skill restored to version ${skill.version}.`
        : `Skill version ${skill.version} published.`,
    metadata: {
      organisationId: input.organisationId,
      playbookKey: skill.playbookKey,
      version: skill.version,
    },
  });
  return { ok: true, status: "published", simulation };
}

export function registerSkillBuilderRoutes(app: Express) {
  app.post("/api/skills/:playbookKey/prepare", async (req, res) => {
    try {
      const { userId, membership } = await requireLocalHttpContext(req);
      const playbookKey = safeKey(req.params.playbookKey);
      const contactId = Number(req.body?.contactId);
      if (!playbookKey) throw new Error("A valid skill key is required.");
      if (!Number.isInteger(contactId) || contactId <= 0)
        throw new Error("A valid customer is required.");

      const db = await getDb();
      if (!db) throw new Error("Database connection is unavailable.");
      const skill = (
        await db
          .select()
          .from(playbookVersions)
          .where(
            and(
              eq(playbookVersions.organisationId, membership.organisationId),
              eq(playbookVersions.playbookKey, playbookKey),
              eq(playbookVersions.status, "published")
            )
          )
          .orderBy(desc(playbookVersions.version))
          .limit(1)
      )[0];
      if (!skill)
        throw new Error(
          "PUBLISHED_SKILL_REQUIRED: this organisation skill is not active."
        );

      const customer = await resolveAssistantCustomerContext({
        userId,
        organisationId: membership.organisationId,
        contactId,
      });
      if (!customer)
        throw new Error(
          "CUSTOMER_CONTEXT_REQUIRED: the exact customer could not be resolved."
        );

      const runtimeInputs =
        req.body?.runtimeInputs &&
        typeof req.body.runtimeInputs === "object" &&
        !Array.isArray(req.body.runtimeInputs)
          ? (req.body.runtimeInputs as Record<string, unknown>)
          : {};
      const compiled = compileLearnedSkillRuntime({
        skillKey: skill.playbookKey,
        definition: skill.inputSchema,
        customer,
        runtimeInputs,
      });
      if (!compiled.matches)
        return res.json({
          matches: false,
          skillId: skill.id,
          playbookKey: skill.playbookKey,
          reason:
            "The current customer/task context does not satisfy this skill's deterministic conditions.",
        });

      const materializedActions =
        await materializeLearnedSkillCommunications({
          organisationId: membership.organisationId,
          actions: compiled.actions,
        });

      if (!materializedActions.length)
        return res.json({
          matches: true,
          skillId: skill.id,
          playbookKey: skill.playbookKey,
          persisted: false,
          internalEffects: compiled.internalEffects,
          actions: [],
        });

      const systems = await attachRuntimeOperationReadiness({
        organisationId: membership.organisationId,
        systems: await listConnectedSystemsForUser(
          userId,
          membership.organisationId
        ),
      });
      const routed = await routeConnectedSystemActionsForUser({
        userId,
        organisationId: membership.organisationId,
        actions: materializedActions,
        systems,
      });
      const workflowRunId = await createWorkflowRun({
        userId,
        organisationId: membership.organisationId,
        workflowKey: `skill:${skill.playbookKey}`.slice(0, 120),
        leadLabel: customer.contactName,
        payload: {
          source: "learned_organisation_skill",
          playbookVersionId: skill.id,
          playbookKey: skill.playbookKey,
          playbookVersion: skill.version,
          contactId,
          contactExternalId: customer.contactExternalId,
          runtimeInputs,
          internalEffects: compiled.internalEffects,
        },
        verificationSummary:
          "AmarktAI matched this published organisation skill deterministically against the exact customer context. Every external action remains governed by CRM capability routing, Review/autonomy policy, target verification, duplicate prevention and readback.",
        actions: routed,
      });
      await db.insert(playbookExecutionHistory).values({
        organisationId: membership.organisationId,
        playbookVersionId: skill.id,
        workflowRunId,
        status: "prepared",
        inputSnapshot: {
          contactId,
          contactExternalId: customer.contactExternalId,
          runtimeInputs,
          internalEffects: compiled.internalEffects,
        },
        outputSummary: `${routed.length} governed action proposal(s) prepared from skill version ${skill.version}.`,
      });

      const proposals = await listActionProposals(
        userId,
        membership.organisationId,
        workflowRunId
      );
      const policy = await getAutomationPolicy({
        userId,
        organisationId: membership.organisationId,
      });
      const autoExecutions = await executeAutoPreapprovedActions({
        userId,
        organisationId: membership.organisationId,
        proposals,
        policy,
      });

      return res.json({
        matches: true,
        persisted: true,
        skillId: skill.id,
        playbookKey: skill.playbookKey,
        version: skill.version,
        workflowRunId,
        proposalCount: proposals.length,
        blockedActionCount: proposals.filter(
          proposal => proposal.state === "blocked"
        ).length,
        internalEffects: compiled.internalEffects,
        autoExecutions,
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.get("/api/skills", async (req, res) => {
    try {
      const { membership } = await requireLocalHttpContext(req);
      const db = await getDb();
      if (!db) throw new Error("Database connection is unavailable.");
      const skills = await db
        .select()
        .from(playbookVersions)
        .where(eq(playbookVersions.organisationId, membership.organisationId))
        .orderBy(desc(playbookVersions.updatedAt), desc(playbookVersions.version));
      return res.json({
        skills: skills.map(skill => {
          const definition = normalizeSkillDefinition(skill.inputSchema);
          return {
            id: skill.id,
            playbookKey: skill.playbookKey,
            version: skill.version,
            title: skill.title,
            instructions: skill.instructions,
            status: skill.status,
            updatedAt: skill.updatedAt,
            publishedAt: skill.publishedAt,
            simulation: simulateSkillDefinition(skill.inputSchema),
            requiredWriteCapabilities: definition.requiredWriteCapabilities,
            writeStatus:
              definition.requiredWriteCapabilities.length > 0 ||
              definition.requiredOperations.some(operation =>
                operation.startsWith("custom.write.")
              )
                ? definition.writeApproval.status
                : "not_required",
          };
        }),
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.get("/api/team-admin/skills", async (req, res) => {
    try {
      const { membership } = await requireManager(req);
      const db = await getDb();
      if (!db) throw new Error("Database connection is unavailable.");
      const skills = await db
        .select()
        .from(playbookVersions)
        .where(eq(playbookVersions.organisationId, membership.organisationId))
        .orderBy(desc(playbookVersions.updatedAt), desc(playbookVersions.version));
      return res.json({
        skills: skills.map(skill => ({
          ...skill,
          simulation: simulateSkillDefinition(skill.inputSchema),
        })),
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/team-admin/skills/compile", async (req, res) => {
    try {
      const { user, membership } = await requireManager(req);
      const compiled = await compileOrganisationSkill({
        userId: user.id,
        organisationId: membership.organisationId,
        sop: typeof req.body?.sop === "string" ? req.body.sop : "",
      });
      const db = await getDb();
      if (!db) throw new Error("Database connection is unavailable.");
      const existing = await db
        .select({ version: playbookVersions.version })
        .from(playbookVersions)
        .where(
          and(
            eq(playbookVersions.organisationId, membership.organisationId),
            eq(playbookVersions.playbookKey, compiled.playbookKey)
          )
        );
      const version = Math.max(0, ...existing.map(row => row.version)) + 1;
      const result = await db.insert(playbookVersions).values({
        organisationId: membership.organisationId,
        playbookKey: compiled.playbookKey,
        version,
        title: compiled.title,
        instructions: compiled.definition.summary,
        inputSchema: compiled.definition,
        status: "draft",
        createdByUserId: user.id,
      });
      await recordAudit({
        userId: user.id,
        eventType: "skill_compiled_from_sop",
        entityType: "playbook_version",
        entityId: String(result[0].insertId),
        summary: `Natural-language SOP compiled into draft skill version ${version}.`,
        metadata: {
          organisationId: membership.organisationId,
          playbookKey: compiled.playbookKey,
          version,
          simulationValid: compiled.simulation.valid,
          creditsCharged: compiled.creditsCharged,
        },
      });
      return res.status(201).json({
        id: Number(result[0].insertId),
        version,
        status: "draft",
        title: compiled.title,
        playbookKey: compiled.playbookKey,
        definition: compiled.definition,
        simulation: compiled.simulation,
        creditsCharged: compiled.creditsCharged,
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/team-admin/skills", async (req, res) => {
    try {
      const { user, membership } = await requireManager(req);
      const playbookKey = safeKey(req.body?.playbookKey);
      const title =
        typeof req.body?.title === "string"
          ? req.body.title.trim().slice(0, 220)
          : "";
      const definition = normalizeSkillDefinition(req.body?.definition);
      if (!playbookKey || !title)
        throw new Error("A skill key and title are required.");
      const db = await getDb();
      if (!db) throw new Error("Database connection is unavailable.");
      const existing = await db
        .select({ version: playbookVersions.version })
        .from(playbookVersions)
        .where(
          and(
            eq(playbookVersions.organisationId, membership.organisationId),
            eq(playbookVersions.playbookKey, playbookKey)
          )
        );
      const version = Math.max(0, ...existing.map(row => row.version)) + 1;
      const result = await db.insert(playbookVersions).values({
        organisationId: membership.organisationId,
        playbookKey,
        version,
        title,
        instructions:
          definition.summary ||
          "Manager-authored organisation skill awaiting simulation.",
        inputSchema: definition,
        status: "draft",
        createdByUserId: user.id,
      });
      await recordAudit({
        userId: user.id,
        eventType: "skill_version_created",
        entityType: "playbook_version",
        entityId: String(result[0].insertId),
        summary: `Draft skill version ${version} created.`,
        metadata: {
          organisationId: membership.organisationId,
          playbookKey,
          version,
        },
      });
      return res.status(201).json({
        id: Number(result[0].insertId),
        version,
        status: "draft",
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/team-admin/skills/:id/simulate", async (req, res) => {
    try {
      const { membership } = await requireManager(req);
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0)
        throw new Error("A valid skill version is required.");
      const skill = await scopedSkill(membership.organisationId, id);
      return res.json({
        skillId: skill.id,
        version: skill.version,
        ...simulateSkillDefinition(skill.inputSchema),
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.get("/api/team-admin/skills/:id/capability-plan", async (req, res) => {
    try {
      const { membership } = await requireManager(req);
      const id = Number(req.params.id);
      const connectedSystemId = Number(req.query.connectedSystemId);
      if (!Number.isInteger(id) || id <= 0)
        throw new Error("A valid skill version is required.");
      if (!Number.isInteger(connectedSystemId) || connectedSystemId <= 0)
        throw new Error("A valid connected system is required.");
      const skill = await scopedSkill(membership.organisationId, id);
      return res.json(
        await buildSkillCapabilityPlan({
          organisationId: membership.organisationId,
          connectedSystemId,
          definition: skill.inputSchema,
        })
      );
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post(
    "/api/team-admin/skills/:id/approve-write-commissioning",
    async (req, res) => {
      try {
        const { user, membership } = await requireManager(req);
        const id = Number(req.params.id);
        const connectedSystemId = Number(req.body?.connectedSystemId);
        if (!Number.isInteger(id) || id <= 0)
          throw new Error("A valid skill version is required.");
        if (!Number.isInteger(connectedSystemId) || connectedSystemId <= 0)
          throw new Error("A valid connected system is required.");
        if (req.body?.confirmWriteCommissioning !== true)
          throw new Error(
            "WRITE_APPROVAL_REQUIRED: explicitly confirm the write commissioning plan first."
          );

        const skill = await scopedSkill(membership.organisationId, id);
        const definition = normalizeSkillDefinition(skill.inputSchema);
        const plan = await buildSkillCapabilityPlan({
          organisationId: membership.organisationId,
          connectedSystemId,
          definition,
        });
        const requestedWriteCapabilities = plan.writeCapabilities.map(
          item => item.capability
        );
        if (!requestedWriteCapabilities.length)
          throw new Error("This skill does not require a CRM write capability.");

        const db = await getDb();
        if (!db) throw new Error("Database connection is unavailable.");
        const existing = await db
          .select({ version: playbookVersions.version })
          .from(playbookVersions)
          .where(
            and(
              eq(playbookVersions.organisationId, membership.organisationId),
              eq(playbookVersions.playbookKey, skill.playbookKey)
            )
          );
        const version = Math.max(0, ...existing.map(row => row.version)) + 1;
        const approvedAt = new Date().toISOString();
        const approvedDefinition = normalizeSkillDefinition({
          ...definition,
          writeApproval: {
            status: "approved_for_commissioning",
            approvedCapabilities: definition.requiredWriteCapabilities,
            approvedOperations: definition.requiredOperations.filter(operation =>
              operation.startsWith("custom.write.")
            ),
            connectedSystemId,
            approvedAt,
          },
        });
        const result = await db.insert(playbookVersions).values({
          organisationId: membership.organisationId,
          playbookKey: skill.playbookKey,
          version,
          title: skill.title,
          instructions: approvedDefinition.summary,
          inputSchema: approvedDefinition,
          status: "draft",
          createdByUserId: user.id,
        });
        await recordAudit({
          userId: user.id,
          eventType: "skill_write_commissioning_approved",
          entityType: "playbook_version",
          entityId: String(result[0].insertId),
          summary: `Write commissioning approved for ${skill.title} version ${version}; no CRM write was enabled or executed.`,
          metadata: {
            organisationId: membership.organisationId,
            sourceSkillVersionId: skill.id,
            connectedSystemId,
            approvedCapabilities: definition.requiredWriteCapabilities,
            approvedOperations: definition.requiredOperations.filter(operation =>
              operation.startsWith("custom.write.")
            ),
            writeExecuted: false,
            writeCapabilityEnabled: false,
          },
        });
        const capabilityPlan = await buildSkillCapabilityPlan({
          organisationId: membership.organisationId,
          connectedSystemId,
          definition: approvedDefinition,
        });
        return res.status(201).json({
          id: Number(result[0].insertId),
          version,
          status: "draft",
          capabilityPlan,
          note:
            "Approval authorises commissioning only. Missing Genie operations still require deterministic learning/proof and workspace write capabilities remain unchanged until separately commissioned.",
        });
      } catch (error) {
        return sendError(res, error);
      }
    }
  );

  app.put("/api/team-admin/skills/:id/publish", async (req, res) => {
    try {
      const { user, membership } = await requireManager(req);
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0)
        throw new Error("A valid skill version is required.");
      return res.json(
        await publishSkill({
          organisationId: membership.organisationId,
          id,
          actorUserId: user.id,
          eventType: "skill_version_published",
        })
      );
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.put("/api/team-admin/skills/:id/rollback", async (req, res) => {
    try {
      const { user, membership } = await requireManager(req);
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0)
        throw new Error("A valid prior skill version is required.");
      return res.json(
        await publishSkill({
          organisationId: membership.organisationId,
          id,
          actorUserId: user.id,
          eventType: "skill_version_rolled_back",
        })
      );
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.put("/api/team-admin/skills/:id/archive", async (req, res) => {
    try {
      const { user, membership } = await requireManager(req);
      const id = Number(req.params.id);
      const db = await getDb();
      if (!db) throw new Error("Database connection is unavailable.");
      const skill = await scopedSkill(membership.organisationId, id);
      await db
        .update(playbookVersions)
        .set({ status: "archived" })
        .where(
          and(
            eq(playbookVersions.id, skill.id),
            eq(
              playbookVersions.organisationId,
              membership.organisationId
            )
          )
        );
      await recordAudit({
        userId: user.id,
        eventType: "skill_version_archived",
        entityType: "playbook_version",
        entityId: String(skill.id),
        summary: `Skill version ${skill.version} archived.`,
        metadata: {
          organisationId: membership.organisationId,
          playbookKey: skill.playbookKey,
        },
      });
      return res.json({ ok: true, status: "archived" });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.get("/api/team-admin/template-catalogue", async (req, res) => {
    try {
      const { membership } = await requireManager(req);
      const connectedSystemId = Number(req.query.connectedSystemId);
      const db = await getDb();
      if (!db) throw new Error("Database connection is unavailable.");
      const templates = await db
        .select()
        .from(approvalTemplates)
        .where(
          eq(approvalTemplates.organisationId, membership.organisationId)
        )
        .orderBy(
          desc(approvalTemplates.updatedAt),
          desc(approvalTemplates.version)
        );
      const readiness = await templateCatalogueReadiness({
        organisationId: membership.organisationId,
        connectedSystemId:
          Number.isInteger(connectedSystemId) && connectedSystemId > 0
            ? connectedSystemId
            : undefined,
      });
      return res.json({ templates, readiness });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/team-admin/template-catalogue/sync", async (req, res) => {
    try {
      const { user, membership } = await requireManager(req);
      const connectedSystemId = Number(req.body?.connectedSystemId);
      if (!Number.isInteger(connectedSystemId) || connectedSystemId <= 0)
        throw new Error("A valid browser CRM connection is required.");
      return res.json(
        await syncTemplateCatalogue({
          organisationId: membership.organisationId,
          connectedSystemId,
          actorUserId: user.id,
        })
      );
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/team-admin/approval-templates", async (req, res) => {
    try {
      const { user, membership } = await requireManager(req);
      const templateKey = safeKey(req.body?.templateKey);
      const title =
        typeof req.body?.title === "string"
          ? req.body.title.trim().slice(0, 220)
          : "";
      const body =
        typeof req.body?.body === "string"
          ? req.body.body.trim().slice(0, 30_000)
          : "";
      if (!templateKey || !title || !body)
        throw new Error("Template key, title and body are required.");
      const db = await getDb();
      if (!db) throw new Error("Database connection is unavailable.");
      const latest = (
        await db
          .select({ version: approvalTemplates.version })
          .from(approvalTemplates)
          .where(
            and(
              eq(
                approvalTemplates.organisationId,
                membership.organisationId
              ),
              eq(approvalTemplates.templateKey, templateKey)
            )
          )
          .orderBy(desc(approvalTemplates.version))
          .limit(1)
      )[0];
      const version = (latest?.version || 0) + 1;
      const result = await db.insert(approvalTemplates).values({
        organisationId: membership.organisationId,
        templateKey,
        version,
        title,
        body,
        status: "draft",
        createdByUserId: user.id,
      });
      await recordAudit({
        userId: user.id,
        eventType: "approval_template_created",
        entityType: "approval_template",
        entityId: String(result[0].insertId),
        summary: `Draft approval template version ${version} created.`,
        metadata: {
          organisationId: membership.organisationId,
          templateKey,
        },
      });
      return res.status(201).json({
        id: Number(result[0].insertId),
        version,
        status: "draft",
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.put(
    "/api/team-admin/approval-templates/:id/publish",
    async (req, res) => {
      try {
        const { user, membership } = await requireManager(req);
        const id = Number(req.params.id);
        const db = await getDb();
        if (!db) throw new Error("Database connection is unavailable.");
        const template = (
          await db
            .select()
            .from(approvalTemplates)
            .where(
              and(
                eq(approvalTemplates.id, id),
                eq(
                  approvalTemplates.organisationId,
                  membership.organisationId
                )
              )
            )
            .limit(1)
        )[0];
        if (!template)
          throw new Error(
            "Template was not found in the active organisation."
          );
        await db.transaction(async tx => {
          await tx
            .update(approvalTemplates)
            .set({ status: "archived" })
            .where(
              and(
                eq(
                  approvalTemplates.organisationId,
                  membership.organisationId
                ),
                eq(
                  approvalTemplates.templateKey,
                  template.templateKey
                ),
                eq(approvalTemplates.status, "published")
              )
            );
          await tx
            .update(approvalTemplates)
            .set({
              status: "published",
              publishedByUserId: user.id,
              publishedAt: new Date(),
            })
            .where(eq(approvalTemplates.id, template.id));
        });
        await recordAudit({
          userId: user.id,
          eventType: "approval_template_published",
          entityType: "approval_template",
          entityId: String(template.id),
          summary: `Approval template version ${template.version} published.`,
          metadata: {
            organisationId: membership.organisationId,
            templateKey: template.templateKey,
          },
        });
        return res.json({ ok: true, status: "published" });
      } catch (error) {
        return sendError(res, error);
      }
    }
  );
}
