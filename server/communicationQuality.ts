import { runGenxAgent } from "./genx";
import { getCompanyAgentContext } from "./db";
import { createHash } from "node:crypto";

export type EmailQualityCheck = { key: string; passed: boolean; detail: string };

const roboticPhrases = [/\bi hope (this )?finds you well\b/i, /\bdelighted to\b/i, /\bleverage\b/i, /\bseamless\b/i, /\bkindly\b/i, /\bplease do not hesitate\b/i];

export function assessHumanEmailDraft(input: { subject: string; body: string; recipientEmail: string; facts: string; templateLocked?: boolean }) {
  const subject = input.subject.trim();
  const body = input.body.trim();
  const checks: EmailQualityCheck[] = [
    { key: "recipient", passed: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.recipientEmail), detail: "A valid recipient email is required." },
    { key: "subject", passed: subject.length >= 3 && subject.length <= 140, detail: "The subject must be clear and between 3 and 140 characters." },
    { key: "body", passed: body.length >= 24 && body.length <= 8_000, detail: "The email body must be present and within the supported review length." },
    { key: "human_tone", passed: !roboticPhrases.some(pattern => pattern.test(body)), detail: "Avoid generic AI or corporate filler so the reply reads naturally." },
    { key: "controlled_punctuation", passed: (body.match(/!/g) ?? []).length <= 1, detail: "Keep punctuation measured and professional." },
    { key: "factual_basis", passed: input.facts.trim().length >= 8, detail: "Provide verified factual context for the draft." },
    { key: "template_boundary", passed: !input.templateLocked || !/\bI have rewritten\b/i.test(body), detail: "A locked template must be preserved; the assistant may only personalise allowed fields." },
  ];
  return checks;
}

function splitDraft(content: string, fallbackSubject: string) {
  const subjectMatch = content.match(/^\s*(?:subject)\s*:\s*(.+)$/im);
  const bodyMarker = content.match(/(?:^|\n)\s*(?:body)\s*:\s*\n?/i);
  const subject = subjectMatch?.[1]?.trim() || fallbackSubject;
  const body = bodyMarker ? content.slice((bodyMarker.index ?? 0) + bodyMarker[0].length).trim() : content.replace(/^\s*subject\s*:.+$/im, "").trim();
  return { subject: subject.slice(0, 300), body: body.slice(0, 8_000) };
}

export function createCommunicationDraftKey(input: { recipientEmail: string; purpose: string; facts: string; threadContext?: string; preferredSubject?: string; templateLocked?: boolean; companyContext?: string }) {
  return createHash("sha256").update(JSON.stringify({ recipientEmail: input.recipientEmail.trim().toLowerCase(), purpose: input.purpose.trim(), facts: input.facts.trim(), threadContext: input.threadContext?.trim() ?? "", preferredSubject: input.preferredSubject?.trim() ?? "", templateLocked: Boolean(input.templateLocked), companyContext: input.companyContext ?? "" })).digest("hex");
}

export async function prepareHumanEmailDraft(input: { userId: number; recipientEmail: string; purpose: string; facts: string; leadLabel?: string; threadContext?: string; preferredSubject?: string; templateLocked?: boolean }) {
  const companyContext = await getCompanyAgentContext(input.userId);
  const task = [
    `Prepare a human, review-only email draft for ${input.recipientEmail}.`,
    `Purpose: ${input.purpose}.`,
    `Verified facts: ${input.facts}.`,
    input.threadContext ? `Thread context: ${input.threadContext}` : "",
    input.templateLocked ? "A saved template is locked. Preserve its wording and only personalise clearly allowed fields." : "This is a fresh draft; do not make unsupported claims.",
    "Output exactly two sections: SUBJECT: followed by one subject line, then BODY: followed by the email. Do not say it was sent.",
  ].filter(Boolean).join("\n\n");
  const response = await runGenxAgent({ userId: input.userId, agentKey: "communications", messages: [{ role: "user", content: task }], companyContext });
  if (response.provider === "not_configured") throw new Error("Amarktai intelligence service is not configured. Configure GenX before creating a model-assisted communication draft.");
  const draft = splitDraft(response.content, input.preferredSubject?.trim() || input.purpose);
  return { ...draft, dedupeKey: createCommunicationDraftKey({ ...input, companyContext }), qualityChecks: assessHumanEmailDraft({ subject: draft.subject, body: draft.body, recipientEmail: input.recipientEmail, facts: input.facts, templateLocked: input.templateLocked }), model: response.model, cacheHit: response.cacheHit };
}
