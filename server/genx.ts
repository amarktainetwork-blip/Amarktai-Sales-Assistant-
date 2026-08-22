import { AGENT_CATALOG } from "./agentCatalog";
import { consumeAiCredits, getAiCreditWallet } from "./aiCredits";
import { currentAiRequestIdentity } from "./aiRequestContext";

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type GenxUsage = { promptTokens?: number; completionTokens?: number; totalTokens?: number };
export type GenxBillingContext = { userId: number; organisationId: number; feature: string; creditCost?: number; reference?: string };

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function featureEnvKey(feature: string) { return `AI_CREDIT_COST_${feature.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toUpperCase()}`; }
function resolvedBilling(input: { agentKey: string; billing?: GenxBillingContext }): GenxBillingContext | undefined {
  if (input.billing) return input.billing;
  const identity = currentAiRequestIdentity();
  return identity ? { ...identity, feature: `assistant_${input.agentKey}` } : undefined;
}
function creditCost(billing?: GenxBillingContext) {
  if (!billing) return 0;
  if (Number.isInteger(billing.creditCost) && (billing.creditCost || 0) >= 0) return Math.min(10_000, billing.creditCost || 0);
  return Math.min(10_000, positiveInt(process.env[featureEnvKey(billing.feature)], positiveInt(process.env.AI_CREDIT_COST_DEFAULT, 1)));
}

function boundedMessages(messages: ChatMessage[], maxChars: number) {
  const selected: ChatMessage[] = [];
  let remaining = maxChars;
  for (let index = messages.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const message = messages[index];
    const content = message.content.trim();
    if (!content) continue;
    const slice = content.length > remaining ? content.slice(content.length - remaining) : content;
    selected.unshift({ role: message.role, content: slice });
    remaining -= slice.length;
  }
  return selected;
}

export function getGenxReadiness() {
  const endpointConfigured = Boolean(process.env.GENX_CHAT_COMPLETIONS_URL);
  const keyConfigured = Boolean(process.env.GENX_API_KEY);
  const modelConfigured = Boolean(process.env.GENX_DEFAULT_MODEL);
  return { ready: endpointConfigured && keyConfigured && modelConfigured, endpointConfigured, keyConfigured, modelConfigured };
}

export async function runGenxAgent(input: { agentKey: string; messages: ChatMessage[]; approvedKnowledge?: string; modelTier?: "fast" | "default" | "reasoning"; billing?: GenxBillingContext }) {
  const readiness = getGenxReadiness();
  const agent = AGENT_CATALOG.find(item => item.key === input.agentKey) ?? AGENT_CATALOG[1];
  const billing = resolvedBilling(input);

  if (!readiness.ready) {
    return { content: "Amarktai intelligence is not connected yet. Configure the GenX chat-completions URL, API key, and default model in deployment secrets.", provider: "not_configured" as const, usage: {} as GenxUsage, creditsCharged: 0 };
  }

  const charge = creditCost(billing);
  if (billing && charge > 0) {
    const wallet = await getAiCreditWallet({ userId: billing.userId, organisationId: billing.organisationId });
    if (wallet.balance < charge) throw new Error(`This AI operation needs ${charge} Amarktai AI Credit${charge === 1 ? "" : "s"}, but the organisation has ${wallet.balance} remaining.`);
  }

  const maxContextChars = Math.min(60_000, positiveInt(process.env.GENX_MAX_CONTEXT_CHARS, 24_000));
  const maxOutputTokens = Math.min(4_000, positiveInt(process.env.GENX_MAX_OUTPUT_TOKENS, 900));
  const knowledgeBudget = Math.min(12_000, Math.floor(maxContextChars * 0.45));
  const approvedKnowledge = input.approvedKnowledge?.trim().slice(0, knowledgeBudget);
  const conversationBudget = Math.max(4_000, maxContextChars - (approvedKnowledge?.length ?? 0));
  const messages = boundedMessages(input.messages, conversationBudget);

  const systemMessage = {
    role: "system" as const,
    content: `You are ${agent.name}, a governed capability inside Amarktai Sales Assistant. ${agent.purpose} Never claim that an external CRM, email, SMS, WhatsApp, phone, or calendar action happened unless the system confirms it. Never invent customer facts, objections, commitments, prices, policies, or product details. Produce concise, practical, review-ready guidance.${approvedKnowledge ? `\n\nApproved company knowledge for this answer:\n${approvedKnowledge}\n\nTreat this material as the authority for company-specific factual claims. If the answer is absent, say so clearly.` : ""}`,
  };

  const model = input.modelTier === "fast" && process.env.GENX_FAST_MODEL?.trim()
    ? process.env.GENX_FAST_MODEL.trim()
    : input.modelTier === "reasoning" && process.env.GENX_REASONING_MODEL?.trim()
      ? process.env.GENX_REASONING_MODEL.trim()
      : process.env.GENX_DEFAULT_MODEL!;

  const response = await fetch(process.env.GENX_CHAT_COMPLETIONS_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GENX_API_KEY!}` },
    body: JSON.stringify({ model, messages: [systemMessage, ...messages], temperature: 0.2, max_tokens: maxOutputTokens }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`GenX request failed with ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ""}`);
  }

  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; input_tokens?: number; output_tokens?: number } };
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("GenX returned no assistant content.");
  const usage: GenxUsage = { promptTokens: payload.usage?.prompt_tokens ?? payload.usage?.input_tokens, completionTokens: payload.usage?.completion_tokens ?? payload.usage?.output_tokens, totalTokens: payload.usage?.total_tokens };

  if (billing && charge > 0) {
    await consumeAiCredits({ userId: billing.userId, organisationId: billing.organisationId, credits: charge, feature: billing.feature, model, providerUsage: { ...usage }, reference: billing.reference });
  }
  return { content, provider: "genx" as const, model, usage, creditsCharged: billing ? charge : 0 };
}
