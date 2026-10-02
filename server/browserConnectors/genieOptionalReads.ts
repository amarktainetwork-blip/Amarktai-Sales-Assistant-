import type { Page } from "playwright-core";
import type { BrowserScriptResult } from "./scriptEngine";
import { readOwnerScopedGenieContactDetail } from "./genieContactDetail";
import { readGenieContactHistory } from "./genieContactHistory";
import { readOwnerScopedGenieOpportunityDetail } from "./genieOpportunityDetail";

export const GENIE_EXACT_OPTIONAL_READS = [
  "contact.open",
  "history.read",
  "note.read",
  "interaction.latest",
  "communication.context",
  "opportunity.read",
  "stage.read",
] as const;

export type GenieExactOptionalRead = (typeof GENIE_EXACT_OPTIONAL_READS)[number];

export function isGenieExactOptionalRead(key: string): key is GenieExactOptionalRead {
  return (GENIE_EXACT_OPTIONAL_READS as readonly string[]).includes(key);
}

/**
 * Each catalogue operation independently executes a real owner/location-scoped
 * Genie GET through the authorised shared browser lease. None of these results
 * are inferred from a cached local CRM record or from a different operation's
 * status. A no-source-result fails closed rather than becoming synthetic proof.
 */
export async function executeGenieExactOptionalRead(input: {
  page: Page;
  operationKey: GenieExactOptionalRead;
  payload: Record<string, unknown>;
  ownerExternalId: string;
  assertControl: () => void;
}): Promise<BrowserScriptResult> {
  if (!input.ownerExternalId) throw Error("CRM_OWNER_SCOPE_REQUIRED");
  const id =
    typeof input.payload.externalId === "string"
      ? input.payload.externalId.trim()
      : typeof input.payload.contactExternalId === "string"
        ? input.payload.contactExternalId.trim()
        : "";
  if (!/^[A-Za-z0-9_-]{1,180}$/.test(id))
    throw Error("GENIE_NATIVE_READ_EXACT_TARGET_REQUIRED");
  const now = () => new Date().toISOString();
  if (input.operationKey === "contact.open")
    return readOwnerScopedGenieContactDetail({
      page: input.page,
      requested: id,
      ownerExternalId: input.ownerExternalId,
      assertControl: input.assertControl,
    });
  if (
    input.operationKey === "opportunity.read" ||
    input.operationKey === "stage.read"
  ) {
    const value = await readOwnerScopedGenieOpportunityDetail({
      page: input.page,
      externalId: id,
      ownerExternalId: input.ownerExternalId,
      assertControl: input.assertControl,
    });
    if (!value) throw Error("GENIE_EXACT_OPPORTUNITY_SOURCE_RECORD_REQUIRED");
    if (input.operationKey === "stage.read" && (!value.stage || !value.pipeline))
      throw Error("GENIE_EXACT_STAGE_SOURCE_FIELDS_REQUIRED");
    return {
      success: true,
      completedAt: now(),
      detail: "Exact owner-scoped Genie opportunity GET and pipeline GET verified.",
      data: {
        actualExternalId: id,
        ownerExternalId: input.ownerExternalId,
        records: JSON.stringify([{
          externalId: value.externalId,
          ownerExternalId: value.ownerExternalId,
          contactExternalId: value.contactExternalId,
          name: value.name,
          pipeline: value.pipeline,
          stage: value.stage,
          sourceKind: value.raw?.sourceKind,
        }]),
        collectionEvidence: "Exact opportunity identity, owner and location were verified by live source GET.",
      },
    };
  }
  const history = await readGenieContactHistory({
    page: input.page,
    ownerExternalId: input.ownerExternalId,
    contactExternalId: id,
    assertControl: input.assertControl,
  });
  let selected = history.activities;
  if (input.operationKey === "note.read") {
    if (history.coverage.notes !== "complete") throw Error("GENIE_NOTE_SOURCE_INCOMPLETE");
    selected = selected.filter(row => row.activityType === "note");
  } else if (input.operationKey === "interaction.latest") {
    selected = [...selected].sort(
      (a,b) => b.occurredAt.getTime() - a.occurredAt.getTime()
    ).slice(0,1);
  } else if (input.operationKey === "communication.context") {
    selected = selected.filter(row => row.raw?.sourceKind === "conversation_message");
  }
  if (!selected.length)
    throw Error("GENIE_NATIVE_READ_NO_GENUINE_SOURCE_RECORD");
  if (selected.some(row =>
    row.contactExternalId !== id || row.ownerExternalId !== input.ownerExternalId
  )) throw Error("CRM_OWNER_SCOPE_VIOLATION");
  return {
    success: true,
    completedAt: now(),
    detail: "Exact owner-scoped Genie contact, notes and conversation GET reads verified.",
    data: {
      actualExternalId: id,
      ownerExternalId: input.ownerExternalId,
      records: JSON.stringify(selected.map(row => ({
        externalId: row.externalId,
        contactExternalId: row.contactExternalId,
        ownerExternalId: row.ownerExternalId,
        activityType: row.activityType,
        occurredAt: row.occurredAt.toISOString(),
        sourceKind: row.raw?.sourceKind,
      }))),
      collectionEvidence: "Verified immutable contact, owner, location and source activity identity by GET.",
    },
  };
}
