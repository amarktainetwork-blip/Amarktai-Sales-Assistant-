import { and, desc, eq } from "drizzle-orm";
import {
  actionProposals,
  assistantMemories,
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

const STYLE_SOURCE_PREFIX = "personal_email_style:microsoft:v1:";
const MAX_SENT_MESSAGES = 40;
const MIN_STYLE_MESSAGES = 5;
const MAX_STYLE_CORPUS_CHARS = 24_000;

function dbOrThrow() {
  return getDb().then(db => {
    if (!db) throw new Error("Database connection is unavailable.");
    return db;
  });
}

function personalStyleSourceReference(userId: number) {
  return `${STYLE_SOURCE_PREFIX}${userId}`;
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
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/https?:\/\/\S+/gi, "[link]")
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
          eq(
            assistantMemories.sourceReference,
            personalStyleSourceReference(userId)
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
    sourceReference: personalStyleSourceReference(input.userId),
    occurredAt: newestSentAt,
  });
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "personal_email_style_learned",
    entityType: "assistant_memory",
    entityId: personalStyleSourceReference(input.userId),
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
    if (!["send_email", "send_email_template"].includes(proposal.actionType))
      continue;
    const payload = (proposal.payload || {}) as Record<string, unknown>;
    const route = payload.crmRoute as { provider?: string } | undefined;
    const body = typeof payload.body === "string" ? payload.body.trim() : "";
    if (
      route?.provider !== "microsoft_delegated" ||
      !body ||
      payload.personalStyleApplied === true
    )
      continue;
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
  const mailboxes = await db
    .select()
    .from(userMailboxConnections)
    .where(
      and(
        eq(userMailboxConnections.provider, "microsoft"),
        eq(userMailboxConnections.status, "ready")
      )
    )
    .orderBy(desc(userMailboxConnections.updatedAt))
    .limit(50);

  let learned = 0;
  let styled = 0;
  let failed = 0;
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
  return { mailboxes: mailboxes.length, learned, styled, failed };
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
      if (result.learned || result.styled || result.failed)
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
