import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  approvalTemplates,
  browserLearnedOperations,
  connectedSystems,
} from "../drizzle/schema";
import { getDb, recordAudit } from "./db";
import {
  loadConnectionSecret,
  toAdapterConnection,
} from "./connectedSystems";
import { getCrmAdapter } from "./crm/adapterRegistry";
import { effectiveLatestBrowserOperation } from "./browserConnectors/learnedOperations";

const TEMPLATE_OPERATION = "custom.read.templates";

type TemplateRow = {
  templateKey: string;
  title: string;
  body: string;
  metadata: {
    channel?: "email" | "sms" | "whatsapp";
    subject?: string;
    folder?: string;
    category?: string;
    sourceReference?: string;
    sourceVersion?: string;
    purpose?: string;
  };
};

function safeKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 140);
}

function parseRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value))
    return value.filter(
      (row): row is Record<string, unknown> =>
        Boolean(row && typeof row === "object" && !Array.isArray(row))
    );
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    return parseRows(JSON.parse(value));
  } catch {
    return [];
  }
}

function rowsFromEvidence(value: unknown): TemplateRow[] {
  const root =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const data =
    root.data && typeof root.data === "object" && !Array.isArray(root.data)
      ? (root.data as Record<string, unknown>)
      : root;
  const candidates = Object.values(data).flatMap(parseRows);
  const output: TemplateRow[] = [];
  for (const row of candidates) {
    const title = String(
      row.title || row.name || row.templateName || row.label || ""
    )
      .trim()
      .slice(0, 220);
    const body = String(
      row.body || row.content || row.message || row.templateBody || ""
    )
      .trim()
      .slice(0, 30_000);
    const templateKey = safeKey(
      String(row.templateKey || row.key || row.id || title)
    );
    if (!templateKey || !title || !body) continue;
    const rawChannel = String(row.channel || row.type || "").trim().toLowerCase();
    const channel =
      rawChannel === "email" || rawChannel === "sms" || rawChannel === "whatsapp"
        ? rawChannel
        : undefined;
    output.push({
      templateKey,
      title,
      body,
      metadata: {
        channel,
        subject: String(row.subject || row.emailSubject || "").trim().slice(0, 500) || undefined,
        folder: String(row.folder || row.folderName || "").trim().slice(0, 220) || undefined,
        category: String(row.category || "").trim().slice(0, 220) || undefined,
        sourceReference: String(row.sourceReference || row.id || "").trim().slice(0, 300) || undefined,
        sourceVersion: String(row.sourceVersion || row.version || "").trim().slice(0, 120) || undefined,
        purpose: String(row.purpose || row.semanticPurpose || "").trim().slice(0, 220) || undefined,
      },
    });
  }
  return Array.from(
    new Map(output.map(template => [template.templateKey, template])).values()
  ).slice(0, 300);
}

export async function templateCatalogueReadiness(input: {
  organisationId: number;
  connectedSystemId?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const systems = await db
    .select()
    .from(connectedSystems)
    .where(eq(connectedSystems.organisationId, input.organisationId));
  const selected = input.connectedSystemId
    ? systems.find(system => system.id === input.connectedSystemId)
    : systems.find(system => system.provider === "genie");
  if (!selected)
    return {
      connectedSystemId: null,
      operationKey: TEMPLATE_OPERATION,
      status: "NOT_LEARNED" as const,
      readOnly: true,
    };
  const revisions = await db
    .select()
    .from(browserLearnedOperations)
    .where(
      and(
        eq(browserLearnedOperations.organisationId, input.organisationId),
        eq(browserLearnedOperations.connectedSystemId, selected.id),
        eq(browserLearnedOperations.operationKey, TEMPLATE_OPERATION)
      )
    )
    .orderBy(desc(browserLearnedOperations.version));
  const latest = effectiveLatestBrowserOperation(revisions[0]);
  return {
    connectedSystemId: selected.id,
    operationKey: TEMPLATE_OPERATION,
    status: latest?.status || ("NOT_LEARNED" as const),
    readOnly: true,
  };
}

export async function syncTemplateCatalogue(input: {
  organisationId: number;
  connectedSystemId: number;
  actorUserId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const system = (
    await db
      .select()
      .from(connectedSystems)
      .where(
        and(
          eq(connectedSystems.id, input.connectedSystemId),
          eq(connectedSystems.organisationId, input.organisationId)
        )
      )
      .limit(1)
  )[0];
  if (!system || !["genie", "custom_browser"].includes(system.provider))
    throw new Error(
      "Template Catalogue requires the active organisation's browser CRM."
    );
  const adapter = getCrmAdapter(system.provider);
  if (!adapter.executeCustomAction)
    throw new Error("This CRM cannot run a learned template catalogue read.");
  const secret = await loadConnectionSecret({
    organisationId: input.organisationId,
    connectedSystemId: system.id,
    secretKind: "browser",
  });
  if (!secret)
    throw new Error(
      "The CRM browser session is unavailable. Sign in again before syncing templates."
    );
  const evidence = await adapter.executeCustomAction({
    connection: toAdapterConnection(system),
    secret,
    actionName: TEMPLATE_OPERATION,
    payload: {},
    correlationId: randomUUID(),
  });
  const templates = rowsFromEvidence(evidence.providerResult);
  if (!templates.length)
    throw new Error(
      "The read-only template operation returned no usable templates. Nothing was changed."
    );

  let imported = 0;
  let unchanged = 0;
  for (const template of templates) {
    const latest = (
      await db
        .select()
        .from(approvalTemplates)
        .where(
          and(
            eq(approvalTemplates.organisationId, input.organisationId),
            eq(approvalTemplates.templateKey, template.templateKey)
          )
        )
        .orderBy(desc(approvalTemplates.version))
        .limit(1)
    )[0];
    if (
      latest &&
      latest.title === template.title &&
      latest.body === template.body &&
      JSON.stringify(latest.metadata || {}) === JSON.stringify(template.metadata || {})
    ) {
      unchanged += 1;
      continue;
    }
    await db.insert(approvalTemplates).values({
      organisationId: input.organisationId,
      templateKey: template.templateKey,
      version: (latest?.version || 0) + 1,
      title: template.title,
      body: template.body,
      metadata: template.metadata,
      status: "draft",
      createdByUserId: input.actorUserId,
    });
    imported += 1;
  }
  await recordAudit({
    userId: input.actorUserId,
    eventType: "template_catalogue_read_sync",
    entityType: "connected_system",
    entityId: String(system.id),
    summary: `Read-only CRM template catalogue sync imported ${imported} draft revision(s).`,
    metadata: {
      organisationId: input.organisationId,
      operationKey: TEMPLATE_OPERATION,
      imported,
      unchanged,
      readOnly: true,
    },
  });
  return { imported, unchanged, total: templates.length, readOnly: true };
}
