import { and, desc, eq } from "drizzle-orm";
import {
  actionProposals,
  assistantMemories,
  crmActivities,
  externalUserMappings,
  userMailboxConnections,
} from "../drizzle/schema";
import { getDb, recordAudit } from "./db";
import {
  delegatedMicrosoftGraphRequest,
  getDelegatedMailboxAccess,
} from "./delegatedMailbox";
import { runGenxAgent } from "./genx";
import { createAssistantMemory, isSafeAssistantMemory } from "./memory";

type GraphSentMessage = {
  id?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { content?: string };
  sentDateTime?: string;
  internetMessageHeaders?: Array<{ name?: string; value?: string }>;
};

type GraphPage<T> = {
  value?: T[];
  "@odata.nextLink"?: string;
};

const STYLE_SOURCE_PREFIX = "personal_email_style:v2:";
const WORK_STYLE_SOURCE_PREFIX = "personal_sales_work_style:v1:";
const MAX_SENT_MESSAGES = 40;
const MIN_STYLE_MESSAGES = 5;
const MIN_WORK_STYLE_SAMPLES = 8;
const MAX_STYLE_CORPUS_CHARS = 24_000;
const MAX_WORK_STYLE_CORPUS_CHARS = 30_000;

function dbOrThrow() {
  return getDb().then(db => {
    if (!db) throw new Error("Database connection is unavailable.");
    return db;
  });
}

function personalStyleSourceReference(userId: number) {
  return `${STYLE_SOURCE_PREFIX}${userId}`;
}

function personalWorkStyleSourceReference(userId: number) {
  return `${WORK_STYLE_SOURCE_PREFIX}${userId}`;
}

function cleanPlainBody(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Keep only the user's newly written portion. Quoted customer history is not
 * evidence of the salesperson's writing style and must never train the profile.
 */
export function stripQuotedEmailHistory(value: string) {
  const body = cleanPlainBody(value);
  const markers = [
    /\n-{2,}\s*Original Message\s*-{2,}/i,
    /\nOn .{1,220} wrote:\s*$/im,
    /\nFrom:\s*[^\n]+\nSent:\s*[^\n]+\nTo:\s*[^\n]+/i,
    /\n_{5,}\s*$/m,
  ];
  let end = body.length;
  for (const marker of markers) {
    const match = marker.exec(body);
    if (match && match.index < end) end = match.index;
  }
  return body.slice(0, end).trim();
}

/** Minimise personal/customer detail before style evidence is sent to GenX. */
export function redactStyleEvidence(value: string) {
  return value
    .replace(/^(hi|hello|dear)\s+[^,\n]+/i, "$1 [name]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/(?:£|\$|€|R)\s?\d[\d,.]*/g, "[amount]")
    .replace(/\b\d+(?:[.,]\d+)?\s*%/g, "[percentage]")
    .replace(/\b(?:\+?\d[\d .()/-]{7,}\d)\b/g, "[number]")
    .replace(/\b\d{5,}\b/g, "[number]")
    .replace(
      /\b(?:password|passcode|pin|otp|mfa code|verification code|access token|refresh token|api key|client secret)\s*[:=-]?\s*\S+/gi,
      "[redacted]"
    )
    .trim();
}

export function isAmarktaiGeneratedSentMessage(message: GraphSentMessage) {
  return Boolean(
    message.internetMessageHeaders?.some(header =>
      /^x-amarktai-/i.test(header.name?.trim() || "")
    )
  );
}

function styleEvidence(message: GraphSentMessage) {
  if (!message.id || isAmarktaiGeneratedSentMessage(message)) return undefined;
  const sentAt = new Date(message.sentDateTime || "");
  if (Number.isNaN(sentAt.valueOf())) return undefined;
  const body = redactStyleEvidence(
    stripQuotedEmailHistory(message.body?.content || message.bodyPreview || "")
  );
  if (body.length < 30) return undefined;
  const subject = redactStyleEvidence(message.subject || "").slice(0, 180);
  return {
    id: message.id,
    sentAt,
    sample: `SUBJECT: ${subject || "[no subject]"}\nBODY:\n${body.slice(0, 2_500)}`,
  };
}

export function crmActivityStyleEvidence(
  activity: {
    externalId: string;
    occurredAt: Date;
    body: string | null;
    raw: unknown;
  },
  identity: { externalUserId: string; email?: string | null }
) {
  const raw =
    activity.raw &&
    typeof activity.raw === "object" &&
    !Array.isArray(activity.raw)
      ? (activity.raw as Record<string, unknown>)
      : {};
  if (
    String(raw.direction || "")
      .trim()
      .toLowerCase() !== "outbound"
  )
    return undefined;
  const externalUserId = identity.externalUserId.trim();
  const actorExternalId = String(raw.userExternalId || "").trim();
  const email = String(identity.email || "")
    .trim()
    .toLowerCase();
  const sender = String(raw.senderReference || "")
    .trim()
    .toLowerCase();
  const authoredByUser =
    Boolean(externalUserId && actorExternalId === externalUserId) ||
    Boolean(
      email &&
        sender &&
        (sender === email ||
          sender.includes(`<${email}>`) ||
          sender.endsWith(` ${email}`))
    );
  if (!authoredByUser) return undefined;
  const body = redactStyleEvidence(
    stripQuotedEmailHistory(activity.body || "")
  );
  if (body.length < 30) return undefined;
  const subject = redactStyleEvidence(String(raw.subject || "")).slice(0, 180);
  return {
    id: activity.externalId,
    sentAt: activity.occurredAt,
    sample: `SUBJECT: ${subject || "[no subject]"}\nBODY:\n${body.slice(0, 2_500)}`,
  };
}

export function crmActivityWorkingStyleEvidence(
  activity: {
    externalId: string;
    activityType: string;
    occurredAt: Date;
    body: string | null;
    raw: unknown;
  },
  identity: { externalUserId: string; email?: string | null }
) {
  const raw =
    activity.raw &&
    typeof activity.raw === "object" &&
    !Array.isArray(activity.raw)
      ? (activity.raw as Record<string, unknown>)
      : {};
  if (/amarktai/i.test(JSON.stringify(raw))) return undefined;
  const actorExternalId = String(
    raw.authorExternalId || raw.userExternalId || ""
  ).trim();
  if (!identity.externalUserId || actorExternalId !== identity.externalUserId)
    return undefined;
  const type = activity.activityType.trim().toLowerCase();
  const direction = String(raw.direction || "").trim().toLowerCase();
  if (
    ["email", "sms", "communication"].includes(type) &&
    direction !== "outbound"
  )
    return undefined;
  if (!["email", "sms", "note", "communication"].includes(type))
    return undefined;
  const body = redactStyleEvidence(
    type === "email"
      ? stripQuotedEmailHistory(activity.body || "")
      : cleanPlainBody(activity.body || "")
  );
  if (body.length < 20) return undefined;
  return {
    id: activity.externalId,
    type,
    occurredAt: activity.occurredAt,
    sample: `TYPE: ${type.toUpperCase()}\nCONTENT:\n${body.slice(0, 2_000)}`,
  };
}

export function buildSalesWorkingProfilePrompt(samples: string[]) {
  return [
    "Learn only stable salesperson working preferences and habits supported by these positively attributed user-authored CRM records.",
    "Return a compact inferred working profile for future assistance, not customer-facing copy and not company policy.",
    "Describe only patterns actually supported across multiple records: communication style by channel, how follow-ups are framed, how callbacks/next steps are recorded, how objections or delays are handled, note structure, level of detail, and recurring decision/workflow habits.",
    "Do not infer a call script or objection rule from one isolated record. Say evidence is limited when a pattern is not repeated.",
    "Do not copy customer names, contact details, prices, salaries, dates, programme promises, eligibility claims, company policies, or customer-specific facts into the profile.",
    "Do not infer protected or sensitive personal traits.",
    "A learned preference is advisory only: it never authorises a CRM write, message send, task change, opportunity change, or any other external action.",
    "Keep the result under 450 words using short labelled lines.",
    "",
    ...samples.map((sample, index) => `EVIDENCE ${index + 1}\n${sample}`),
  ].join("\n\n");
}

export function buildPersonalEmailStyleLearningPrompt(samples: string[]) {
  return [
    "Learn only the salesperson's stable writing preferences from these genuine sent-email samples.",
    "Return a compact preference note for future drafting, not an email.",
    "Describe: tone/formality, typical length and structure, openings, sign-offs, follow-up/CTA style, formatting habits, and recurring template structures.",
    "Only call something a recurring template or pattern when it is clearly present in at least two separate samples.",
    "Do not copy customer names, email addresses, phone numbers, account/order numbers, prices, URLs, signatures, legal boilerplate, or customer-specific facts into the preference note.",
    "Do not infer protected/sensitive personal traits. Do not invent preferences that the samples do not support.",
    "If evidence is mixed, say the style varies rather than forcing one rule.",
    "Keep the result under 300 words and use short labelled lines.",
    "",
    ...samples.map((sample, index) => `SAMPLE ${index + 1}\n${sample}`),
  ].join("\n\n");
}

function protectedDraftLiterals(value: string) {
  const matches = value.match(
    /(?:https?:\/\/\S+|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|(?:R|\$|£|€)\s?\d[\d.,]*|\b\d{1,4}[/-]\d{1,2}[/-]\d{1,4}\b|\b\d+(?:[.,]\d+)?%\b|\b\d{4,}\b)/gi
  );
  return new Set(
    (matches || []).map(item => item.toLowerCase().replace(/[),.;]+$/, ""))
  );
}

/** A style-only rewrite may not remove or introduce protected factual literals. */
export function rewritePreservesProtectedLiterals(
  original: string,
  rewrite: string
) {
  const before = protectedDraftLiterals(original);
  const after = protectedDraftLiterals(rewrite);
  if (before.size !== after.size) return false;
  return Array.from(before).every(value => after.has(value));
}

async function accessTokenForLearning(
  mailbox: typeof userMailboxConnections.$inferSelect
) {
  return (
    await getDelegatedMailboxAccess({
      userId: mailbox.userId,
      organisationId: mailbox.organisationId,
    })
  ).accessToken;
}

async function graphGet<T>(accessToken: string, pathOrUrl: string) {
  return delegatedMicrosoftGraphRequest<T>(accessToken, pathOrUrl, {
    headers: { Prefer: 'outlook.body-content-type="text"' },
  });
}

async function recentSentMessages(accessToken: string) {
  const query = new URLSearchParams({
    $top: "25",
    $orderby: "sentDateTime desc",
    $select: "id,subject,bodyPreview,body,sentDateTime,internetMessageHeaders",
  });
  let next: string | undefined =
    `/me/mailFolders/sentitems/messages?${query.toString()}`;
  const messages: GraphSentMessage[] = [];
  while (next && messages.length < MAX_SENT_MESSAGES) {
    const page: GraphPage<GraphSentMessage> = await graphGet<
      GraphPage<GraphSentMessage>
    >(accessToken, next);
    messages.push(...(page.value || []));
    next = page["@odata.nextLink"];
  }
  return messages.slice(0, MAX_SENT_MESSAGES);
}

async function currentStyleMemory(userId: number, organisationId: number) {
  const db = await dbOrThrow();
  return (
    await db
      .select()
      .from(assistantMemories)
      .where(
        and(
          eq(assistantMemories.userId, userId),
          eq(assistantMemories.organisationId, organisationId),
          eq(assistantMemories.memoryType, "user_preference"),
          eq(
            assistantMemories.subject,
            "Personal email writing style and recurring patterns"
          ),
          eq(assistantMemories.status, "active")
        )
      )
      .orderBy(desc(assistantMemories.updatedAt))
      .limit(1)
  )[0];
}

async function currentWorkStyleMemory(
  userId: number,
  organisationId: number
) {
  const db = await dbOrThrow();
  return (
    await db
      .select()
      .from(assistantMemories)
      .where(
        and(
          eq(assistantMemories.userId, userId),
          eq(assistantMemories.organisationId, organisationId),
          eq(assistantMemories.memoryType, "user_preference"),
          eq(
            assistantMemories.subject,
            "Sales working style and follow-up patterns"
          ),
          eq(assistantMemories.status, "active")
        )
      )
      .orderBy(desc(assistantMemories.updatedAt))
      .limit(1)
  )[0];
}

export async function learnPersonalEmailStyle(input: {
  userId: number;
  organisationId: number;
  mailbox: typeof userMailboxConnections.$inferSelect;
}) {
  const accessToken = await accessTokenForLearning(input.mailbox);
  const evidence = (await recentSentMessages(accessToken))
    .map(styleEvidence)
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => right.sentAt.valueOf() - left.sentAt.valueOf());
  if (evidence.length < MIN_STYLE_MESSAGES)
    return {
      learned: false as const,
      reason: "not_enough_user_sent_mail" as const,
    };

  const previous = await currentStyleMemory(input.userId, input.organisationId);
  const styleReference =
    previous?.sourceReference || personalStyleSourceReference(input.userId);
  const newestSentAt = evidence[0].sentAt;
  if (
    previous?.occurredAt &&
    previous.occurredAt.valueOf() >= newestSentAt.valueOf()
  )
    return {
      learned: false as const,
      reason: "no_new_user_sent_mail" as const,
    };

  const samples: string[] = [];
  let characters = 0;
  for (const item of evidence) {
    if (characters >= MAX_STYLE_CORPUS_CHARS) break;
    const remaining = MAX_STYLE_CORPUS_CHARS - characters;
    const sample = item.sample.slice(0, remaining);
    if (sample.length < 30) continue;
    samples.push(sample);
    characters += sample.length;
  }
  if (samples.length < MIN_STYLE_MESSAGES)
    return {
      learned: false as const,
      reason: "not_enough_bounded_evidence" as const,
    };

  const response = await runGenxAgent({
    agentKey: "communications",
    messages: [
      {
        role: "user",
        content: buildPersonalEmailStyleLearningPrompt(samples),
      },
    ],
    workingContext:
      "This is private, user-scoped preference learning from the salesperson's own confirmed Sent Items. The result is an inferred style preference, never company policy and never permission to send anything.",
    billing: {
      userId: input.userId,
      organisationId: input.organisationId,
      feature: "personal_email_style_learning",
      reference: `sent-style:${newestSentAt.toISOString()}`,
    },
    maxContextChars: 30_000,
    maxOutputTokens: 450,
  });
  const content = response.content.trim().slice(0, 8_000);
  if (
    !content ||
    /intelligence is not connected|cannot run safely/i.test(content) ||
    !isSafeAssistantMemory(content)
  )
    return {
      learned: false as const,
      reason: "style_summary_unavailable" as const,
    };

  await createAssistantMemory({
    userId: input.userId,
    organisationId: input.organisationId,
    memoryType: "user_preference",
    subject: "Personal email writing style and recurring patterns",
    content,
    provenance: "approved_ai_extraction",
    trust: "inferred",
    sourceReference: styleReference,
    occurredAt: newestSentAt,
  });
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "personal_email_style_learned",
    entityType: "assistant_memory",
    entityId: styleReference,
    summary:
      "Amarktai refreshed the salesperson's private inferred email-writing preferences from their own genuine Sent Items.",
    metadata: {
      provider: "microsoft",
      sampleCount: samples.length,
      excludesAmarktaiGeneratedMail: true,
      trust: "inferred",
    },
  });
  return { learned: true as const, sampleCount: samples.length, content };
}

export async function learnPersonalEmailStyleFromCrm(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
  externalUserId: string;
  email?: string | null;
}) {
  const db = await dbOrThrow();
  const rows = await db
    .select({
      externalId: crmActivities.externalId,
      occurredAt: crmActivities.occurredAt,
      body: crmActivities.body,
      raw: crmActivities.raw,
    })
    .from(crmActivities)
    .where(
      and(
        eq(crmActivities.organisationId, input.organisationId),
        eq(crmActivities.connectedSystemId, input.connectedSystemId),
        eq(crmActivities.ownerExternalId, input.externalUserId),
        eq(crmActivities.activityType, "email")
      )
    )
    .orderBy(desc(crmActivities.occurredAt))
    .limit(80);
  const evidence = rows
    .map(activity =>
      crmActivityStyleEvidence(activity, {
        externalUserId: input.externalUserId,
        email: input.email,
      })
    )
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, MAX_SENT_MESSAGES);
  if (evidence.length < MIN_STYLE_MESSAGES)
    return {
      learned: false as const,
      reason: "not_enough_verified_crm_sent_mail" as const,
    };

  const previous = await currentStyleMemory(input.userId, input.organisationId);
  const styleReference =
    previous?.sourceReference || personalStyleSourceReference(input.userId);
  const newestSentAt = evidence[0].sentAt;
  if (
    previous?.occurredAt &&
    previous.occurredAt.valueOf() >= newestSentAt.valueOf()
  )
    return {
      learned: false as const,
      reason: "no_new_verified_crm_sent_mail" as const,
    };

  const samples: string[] = [];
  let characters = 0;
  for (const item of evidence) {
    if (characters >= MAX_STYLE_CORPUS_CHARS) break;
    const remaining = MAX_STYLE_CORPUS_CHARS - characters;
    const sample = item.sample.slice(0, remaining);
    if (sample.length < 30) continue;
    samples.push(sample);
    characters += sample.length;
  }
  if (samples.length < MIN_STYLE_MESSAGES)
    return {
      learned: false as const,
      reason: "not_enough_bounded_crm_evidence" as const,
    };

  const response = await runGenxAgent({
    agentKey: "communications",
    messages: [
      {
        role: "user",
        content: buildPersonalEmailStyleLearningPrompt(samples),
      },
    ],
    workingContext:
      "This is private, user-scoped preference learning from verified read-only CRM outbound email activity attributed to the mapped salesperson. The result is an inferred style preference, never company policy and never permission to send anything.",
    billing: {
      userId: input.userId,
      organisationId: input.organisationId,
      feature: "personal_email_style_learning",
      reference: `crm-style:${input.connectedSystemId}:${newestSentAt.toISOString()}`,
    },
    maxContextChars: 30_000,
    maxOutputTokens: 450,
  });
  const content = response.content.trim().slice(0, 8_000);
  if (
    !content ||
    /intelligence is not connected|cannot run safely/i.test(content) ||
    !isSafeAssistantMemory(content)
  )
    return {
      learned: false as const,
      reason: "style_summary_unavailable" as const,
    };

  await createAssistantMemory({
    userId: input.userId,
    organisationId: input.organisationId,
    memoryType: "user_preference",
    subject: "Personal email writing style and recurring patterns",
    content,
    provenance: "approved_ai_extraction",
    trust: "inferred",
    sourceReference: styleReference,
    occurredAt: newestSentAt,
  });
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "personal_email_style_learned",
    entityType: "assistant_memory",
    entityId: styleReference,
    summary:
      "Amarktai refreshed the salesperson's private inferred email-writing preferences from verified read-only CRM sent activity.",
    metadata: {
      provider: "crm_read",
      connectedSystemId: input.connectedSystemId,
      sampleCount: samples.length,
      exactMappedUser: input.externalUserId,
      trust: "inferred",
    },
  });
  return { learned: true as const, sampleCount: samples.length, content };
}

export async function learnSalesWorkingProfileFromCrm(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
  externalUserId: string;
  email?: string | null;
}) {
  const db = await dbOrThrow();
  const rows = await db
    .select({
      externalId: crmActivities.externalId,
      activityType: crmActivities.activityType,
      occurredAt: crmActivities.occurredAt,
      body: crmActivities.body,
      raw: crmActivities.raw,
    })
    .from(crmActivities)
    .where(
      and(
        eq(crmActivities.organisationId, input.organisationId),
        eq(crmActivities.connectedSystemId, input.connectedSystemId)
      )
    )
    .orderBy(desc(crmActivities.occurredAt))
    .limit(240);
  const evidence = rows
    .map(activity =>
      crmActivityWorkingStyleEvidence(activity, {
        externalUserId: input.externalUserId,
        email: input.email,
      })
    )
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (evidence.length < MIN_WORK_STYLE_SAMPLES)
    return {
      learned: false as const,
      reason: "not_enough_verified_working_evidence" as const,
    };

  const previous = await currentWorkStyleMemory(
    input.userId,
    input.organisationId
  );
  const newestAt = evidence[0].occurredAt;
  if (
    previous?.occurredAt &&
    previous.occurredAt.valueOf() >= newestAt.valueOf()
  )
    return {
      learned: false as const,
      reason: "no_new_verified_working_evidence" as const,
    };

  const samples: string[] = [];
  let characters = 0;
  const typeCounts = new Map<string, number>();
  for (const item of evidence) {
    if (characters >= MAX_WORK_STYLE_CORPUS_CHARS) break;
    const count = typeCounts.get(item.type) || 0;
    if (count >= 18) continue;
    const remaining = MAX_WORK_STYLE_CORPUS_CHARS - characters;
    const sample = item.sample.slice(0, remaining);
    if (sample.length < 20) continue;
    samples.push(sample);
    characters += sample.length;
    typeCounts.set(item.type, count + 1);
  }
  if (samples.length < MIN_WORK_STYLE_SAMPLES)
    return {
      learned: false as const,
      reason: "not_enough_bounded_working_evidence" as const,
    };

  const response = await runGenxAgent({
    agentKey: "conversation_coach",
    messages: [
      {
        role: "user",
        content: buildSalesWorkingProfilePrompt(samples),
      },
    ],
    workingContext:
      "Private user-scoped preference learning from positively attributed CRM records. Learn how the salesperson tends to work, never what the company requires and never what the system is authorised to execute.",
    billing: {
      userId: input.userId,
      organisationId: input.organisationId,
      feature: "personal_working_style_learning",
      reference: `crm-work-style:${input.connectedSystemId}:${newestAt.toISOString()}`,
    },
    maxContextChars: 36_000,
    maxOutputTokens: 650,
  });
  const content = response.content.trim().slice(0, 10_000);
  if (
    !content ||
    /intelligence is not connected|cannot run safely/i.test(content) ||
    !isSafeAssistantMemory(content)
  )
    return {
      learned: false as const,
      reason: "working_profile_unavailable" as const,
    };

  const sourceReference =
    previous?.sourceReference ||
    personalWorkStyleSourceReference(input.userId);
  await createAssistantMemory({
    userId: input.userId,
    organisationId: input.organisationId,
    memoryType: "user_preference",
    subject: "Sales working style and follow-up patterns",
    content,
    provenance: "approved_ai_extraction",
    trust: "inferred",
    sourceReference,
    occurredAt: newestAt,
  });
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "personal_sales_working_style_learned",
    entityType: "assistant_memory",
    entityId: sourceReference,
    summary:
      "Amarktai refreshed the salesperson's private inferred working profile from positively attributed read-only CRM activity.",
    metadata: {
      connectedSystemId: input.connectedSystemId,
      sampleCount: samples.length,
      evidenceTypes: Object.fromEntries(typeCounts),
      exactMappedUser: input.externalUserId,
      trust: "inferred",
      permissionGranted: false,
    },
  });
  return {
    learned: true as const,
    sampleCount: samples.length,
    content,
  };
}

export function shouldApplyPersonalStyleToDraft(input: {
  actionType: string;
  payload: Record<string, unknown>;
}) {
  const route = input.payload.crmRoute as { provider?: string } | undefined;
  const body =
    typeof input.payload.body === "string" ? input.payload.body.trim() : "";
  return (
    ["send_email", "send_email_template"].includes(input.actionType) &&
    Boolean(body) &&
    input.payload.personalStyleApplied !== true &&
    (route?.provider === "microsoft_delegated" ||
      input.payload.draftOnly === true)
  );
}

function cleanRewrite(value: string) {
  return value
    .replace(/^```(?:html|markdown|text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()
    .slice(0, 20_000);
}

export async function applyPersonalEmailStyleToPendingDrafts(input: {
  userId: number;
  organisationId: number;
}) {
  const db = await dbOrThrow();
  const style = await currentStyleMemory(input.userId, input.organisationId);
  if (!style?.content) return { styled: 0 };
  const proposals = await db
    .select()
    .from(actionProposals)
    .where(
      and(
        eq(actionProposals.userId, input.userId),
        eq(actionProposals.organisationId, input.organisationId),
        eq(actionProposals.state, "review_required")
      )
    )
    .orderBy(desc(actionProposals.createdAt))
    .limit(12);

  let styled = 0;
  for (const proposal of proposals) {
    const payload = (proposal.payload || {}) as Record<string, unknown>;
    if (
      !shouldApplyPersonalStyleToDraft({
        actionType: proposal.actionType,
        payload,
      })
    )
      continue;
    const body = String(payload.body).trim();
    const response = await runGenxAgent({
      agentKey: "communications",
      messages: [
        {
          role: "user",
          content:
            "Rewrite only the wording and presentation of this already-grounded review draft so it sounds like the salesperson. Preserve every factual claim, commitment, date, price, percentage, link, email address and call-to-action. Do not add facts, promises or offers. Do not add a subject line. Return only the revised body.\n\nINFERRED PERSONAL STYLE:\n" +
            style.content.slice(0, 6_000) +
            "\n\nCURRENT REVIEW DRAFT:\n" +
            body,
        },
      ],
      workingContext:
        "Style-only rewrite of an existing customer email draft. Company facts and the existing draft outrank personal style. The result remains review-required and must not be sent here.",
      billing: {
        userId: input.userId,
        organisationId: input.organisationId,
        feature: "personal_email_style_apply",
        reference: `proposal:${proposal.id}:style-v1`,
      },
      maxOutputTokens: 700,
    });
    const rewrite = cleanRewrite(response.content);
    if (
      !rewrite ||
      /intelligence is not connected|cannot run safely/i.test(rewrite) ||
      !rewritePreservesProtectedLiterals(body, rewrite)
    )
      continue;
    await db
      .update(actionProposals)
      .set({
        payload: {
          ...payload,
          body: rewrite,
          personalStyleApplied: true,
          personalStyleMemoryId: style.id,
        },
      })
      .where(
        and(
          eq(actionProposals.id, proposal.id),
          eq(actionProposals.userId, input.userId),
          eq(actionProposals.organisationId, input.organisationId),
          eq(actionProposals.state, "review_required")
        )
      );
    styled += 1;
  }
  return { styled };
}

export async function runPersonalWorkLearning() {
  const db = await dbOrThrow();
  const [mailboxes, mappings] = await Promise.all([
    db
      .select()
      .from(userMailboxConnections)
      .where(
        and(
          eq(userMailboxConnections.provider, "microsoft"),
          eq(userMailboxConnections.status, "ready")
        )
      )
      .orderBy(desc(userMailboxConnections.updatedAt))
      .limit(50),
    db
      .select()
      .from(externalUserMappings)
      .where(eq(externalUserMappings.isActive, true))
      .orderBy(desc(externalUserMappings.updatedAt))
      .limit(100),
  ]);

  let learned = 0;
  let workProfilesLearned = 0;
  let styled = 0;
  let failed = 0;
  const microsoftUsers = new Set(
    mailboxes.map(mailbox => `${mailbox.organisationId}:${mailbox.userId}`)
  );
  const allCrmMappings = Array.from(
    mappings
      .filter(mapping => mapping.userId != null)
      .reduce((unique, mapping) => {
        const key = `${mapping.organisationId}:${mapping.userId}`;
        if (!unique.has(key)) unique.set(key, mapping);
        return unique;
      }, new Map<string, (typeof mappings)[number]>())
      .values()
  );
  for (const mailbox of mailboxes) {
    try {
      const result = await learnPersonalEmailStyle({
        userId: mailbox.userId,
        organisationId: mailbox.organisationId,
        mailbox,
      });
      if (result.learned) learned += 1;
      styled += (
        await applyPersonalEmailStyleToPendingDrafts({
          userId: mailbox.userId,
          organisationId: mailbox.organisationId,
        })
      ).styled;
    } catch (error) {
      failed += 1;
      console.error(
        JSON.stringify({
          event: "personal_work_learning_failed",
          source: "microsoft",
          userId: mailbox.userId,
          organisationId: mailbox.organisationId,
          detail:
            error instanceof Error
              ? error.message.slice(0, 400)
              : String(error).slice(0, 400),
        })
      );
    }
  }

  const crmMappings = allCrmMappings.filter(
    mapping =>
      !microsoftUsers.has(`${mapping.organisationId}:${mapping.userId}`)
  );
  for (const mapping of crmMappings) {
    try {
      const result = await learnPersonalEmailStyleFromCrm({
        userId: mapping.userId!,
        organisationId: mapping.organisationId,
        connectedSystemId: mapping.connectedSystemId,
        externalUserId: mapping.externalUserId,
        email: mapping.email,
      });
      if (result.learned) learned += 1;
      styled += (
        await applyPersonalEmailStyleToPendingDrafts({
          userId: mapping.userId!,
          organisationId: mapping.organisationId,
        })
      ).styled;
    } catch (error) {
      failed += 1;
      console.error(
        JSON.stringify({
          event: "personal_work_learning_failed",
          source: "crm_read",
          userId: mapping.userId,
          organisationId: mapping.organisationId,
          connectedSystemId: mapping.connectedSystemId,
          detail:
            error instanceof Error
              ? error.message.slice(0, 400)
              : String(error).slice(0, 400),
        })
      );
    }
  }
  for (const mapping of allCrmMappings) {
    try {
      const result = await learnSalesWorkingProfileFromCrm({
        userId: mapping.userId!,
        organisationId: mapping.organisationId,
        connectedSystemId: mapping.connectedSystemId,
        externalUserId: mapping.externalUserId,
        email: mapping.email,
      });
      if (result.learned) workProfilesLearned += 1;
    } catch (error) {
      failed += 1;
      console.error(
        JSON.stringify({
          event: "personal_work_learning_failed",
          source: "crm_working_profile",
          userId: mapping.userId,
          organisationId: mapping.organisationId,
          connectedSystemId: mapping.connectedSystemId,
          detail:
            error instanceof Error
              ? error.message.slice(0, 400)
              : String(error).slice(0, 400),
        })
      );
    }
  }

  return {
    mailboxes: mailboxes.length,
    crmMappings: crmMappings.length,
    workingProfileMappings: allCrmMappings.length,
    learned,
    workProfilesLearned,
    styled,
    failed,
  };
}

export function startPersonalWorkLearningWorker(
  pollMs = Math.max(
    5 * 60_000,
    Number(process.env.PERSONAL_WORK_LEARNING_INTERVAL_MS || 30 * 60_000)
  )
) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runPersonalWorkLearning();
      if (
        result.learned ||
        result.workProfilesLearned ||
        result.styled ||
        result.failed
      )
        console.log(
          JSON.stringify({ event: "personal_work_learning", ...result })
        );
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), pollMs);
  timer.unref();
  return timer;
}
