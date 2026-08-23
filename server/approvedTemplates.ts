import { and, desc, eq, or } from "drizzle-orm";
import { approvalTemplates } from "../drizzle/schema";
import { getDb } from "./db";
import { validateSalesMessage } from "./communications";
import type { SalesChannel } from "./communications";

function templateKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .slice(0, 140);
}

export async function resolveApprovedCommunicationTemplate(input: {
  organisationId: number;
  channel: SalesChannel;
  templateName: string;
  to: string;
}) {
  const requested = input.templateName.trim();
  if (!requested)
    throw new Error("TEMPLATE_CONTENT_REQUIRED: choose an approved template.");
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const approved = (
    await db
      .select()
      .from(approvalTemplates)
      .where(
        and(
          eq(approvalTemplates.organisationId, input.organisationId),
          eq(approvalTemplates.status, "published"),
          or(
            eq(approvalTemplates.templateKey, templateKey(requested)),
            eq(approvalTemplates.title, requested)
          )
        )
      )
      .orderBy(desc(approvalTemplates.version))
      .limit(1)
  )[0];
  return materializeApprovedCommunicationTemplate({ ...input, approved });
}

export function materializeApprovedCommunicationTemplate(input: {
  channel: SalesChannel;
  to: string;
  approved?: {
    id: number;
    templateKey: string;
    version: number;
    title: string;
    body: string;
  };
}) {
  const approved = input.approved;
  if (!approved)
    throw new Error(
      "TEMPLATE_NOT_FOUND: the named published organisation template could not be resolved."
    );
  const message = validateSalesMessage({
    channel: input.channel,
    to: input.to,
    subject: input.channel === "email" ? approved.title : undefined,
    body: approved.body,
    templateName: approved.title,
  });
  return {
    ...message,
    approvalTemplateId: approved.id,
    approvalTemplateKey: approved.templateKey,
    approvalTemplateVersion: approved.version,
  };
}

export function prepareCustomCommunication(input: {
  channel: SalesChannel;
  to: string;
  subject?: string;
  body: string;
}) {
  return validateSalesMessage(input);
}
