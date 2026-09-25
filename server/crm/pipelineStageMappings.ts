import { and, eq } from "drizzle-orm";
import {
  connectedSystems,
  crmPipelineStageMappings,
} from "../../drizzle/schema";
import { getDb, recordAudit } from "../db";

export type CrmPipelineStageCategory =
  | "open"
  | "qualified"
  | "proposal"
  | "won"
  | "lost"
  | "other";

export async function saveCrmPipelineStageMapping(input: {
  organisationId: number;
  actorUserId: number;
  connectedSystemId: number;
  externalPipelineId: string;
  externalStageId: string;
  pipelineLabel: string;
  stageLabel: string;
  category: CrmPipelineStageCategory;
  isActive?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const system = (
    await db
      .select({ id: connectedSystems.id, status: connectedSystems.status })
      .from(connectedSystems)
      .where(
        and(
          eq(connectedSystems.id, input.connectedSystemId),
          eq(connectedSystems.organisationId, input.organisationId)
        )
      )
      .limit(1)
  )[0];
  if (!system)
    throw new Error(
      "Connected system was not found in the active organisation."
    );
  if (!["ready", "limited_permissions"].includes(system.status))
    throw new Error(
      "Pipeline mappings require a backend-verified connected system."
    );

  const isActive = input.isActive ?? true;
  await db
    .insert(crmPipelineStageMappings)
    .values({
      organisationId: input.organisationId,
      connectedSystemId: input.connectedSystemId,
      externalPipelineId: input.externalPipelineId,
      externalStageId: input.externalStageId,
      pipelineLabel: input.pipelineLabel,
      stageLabel: input.stageLabel,
      category: input.category,
      isActive,
    })
    .onDuplicateKeyUpdate({
      set: {
        externalPipelineId: input.externalPipelineId,
        pipelineLabel: input.pipelineLabel,
        stageLabel: input.stageLabel,
        category: input.category,
        isActive,
      },
    });
  await recordAudit({
    userId: input.actorUserId,
    eventType: "crm_pipeline_stage_mapping_saved",
    entityType: "crm_pipeline_stage_mapping",
    entityId: `${input.connectedSystemId}:${input.externalStageId}`,
    summary: `CRM stage '${input.stageLabel}' mapping was saved.`,
    metadata: {
      organisationId: input.organisationId,
      connectedSystemId: input.connectedSystemId,
      externalPipelineId: input.externalPipelineId,
      externalStageId: input.externalStageId,
      category: input.category,
      isActive,
    },
  });
  return { ok: true as const };
}
