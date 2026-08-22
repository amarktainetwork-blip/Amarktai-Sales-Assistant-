import { AGENT_CATALOG } from "./agentCatalog";
import { compactAgentMessages, compactKnowledge, createAgentRequestHash, getAgentModel, getAgentPolicy } from "./agentPolicies";
import { getCachedAgentResponse, recordAgentUsage, saveCachedAgentResponse } from "./db";

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type GenxAgentResult = { content: string; provider: "genx" | "not_configured"; model: string | null; cacheHit: boolean; usage?: { inputTokens?: number; outputTokens?: number } };

export function getGenxReadiness() {
  const endpointConfigured = Boolean(process.env.GENX_CHAT_COMPLETIONS_URL);
  const keyConfigured = Boolean(process.env.GENX_API_KEY);
  const modelConfigured = Boolean(process.env.GENX_DEFAULT_MODEL);
  return { ready: endpointConfigured && keyConfigured && modelConfigured, endpointConfigured, keyConfigured, modelConfigured };
}

function getGenxModelsUrl() {
  const configured = process.env.GENX_CHAT_COMPLETIONS_URL?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    url.pathname = url.pathname.replace(/\/chat\/completions\/?$/, "/models");
    return url.toString();
  } catch {
    return null;
  }
}

async function fetchWithTimeout(fetcher: typeof fetch, input: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    return await fetcher(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function verifyGenxConnection(fetcher: typeof fetch = fetch) {
  const readiness = getGenxReadiness();
  const modelsUrl = getGenxModelsUrl();
  if (!readiness.ready || !modelsUrl) return { ready: false as const, reason: "not_configured" as const };
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GENX_API_KEY!}` };
  try {
    const modelsResponse = await fetchWithTimeout(fetcher, modelsUrl, { headers });
    if (!modelsResponse.ok) return { ready: false as const, reason: "models_unavailable" as const };
    const modelsPayload = (await modelsResponse.json()) as { data?: Array<{ id?: string }> };
    const advertisedModels = modelsPayload.data?.map(model => model.id).filter((value): value is string => Boolean(value)) ?? [];
    if (advertisedModels.length && !advertisedModels.includes(process.env.GENX_DEFAULT_MODEL!)) return { ready: false as const, reason: "configured_model_not_advertised" as const };
    const completionResponse = await fetchWithTimeout(fetcher, process.env.GENX_CHAT_COMPLETIONS_URL!, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: process.env.GENX_DEFAULT_MODEL!, messages: [{ role: "user", content: "Return READY." }], temperature: 0, max_tokens: 8 }),
    });
    if (!completionResponse.ok) return { ready: false as const, reason: "minimal_request_failed" as const };
    const payload = (await completionResponse.json()) as { choices?: Array<{ message?: { content?: string } }> };
    if (!payload.choices?.[0]?.message?.content?.trim()) return { ready: false as const, reason: "minimal_request_invalid" as const };
    return { ready: true as const, reason: "verified" as const };
  } catch {
    return { ready: false as const, reason: "verification_failed" as const };
  }
}

export function buildAgentSystemPrompt(input: { agentName: string; agentPurpose: string; policy: ReturnType<typeof getAgentPolicy>; companyContext?: string; approvedKnowledge?: string }) {
  return [
    `You are ${input.agentName} for the organisation using Amarktai Sales Assistant. ${input.agentPurpose}`,
    ...input.policy.instructions,
    "Never claim that an external CRM, email, SMS, WhatsApp, or calendar action happened unless the system confirms it.",
    "Never invent candidate facts, objections, commitments, programme details, consent, or communication history.",
    input.policy.outputContract,
    input.companyContext ? `Approved company operating context:\n${input.companyContext}\nUse this for tone, audience, and sales-motion alignment. It is not authority for customer-, product-, service-, price-, funding-, or policy-specific claims.` : "No approved company profile was supplied. Do not assume a brand voice, market, or sales motion.",
    input.approvedKnowledge ? `Approved knowledge sources for this answer:\n${input.approvedKnowledge}\nTreat these sources as the only authority for product, service, policy, pricing, entry requirement, and eligibility claims. If an answer is not present, say so plainly.` : "No approved knowledge was supplied. Do not make product, service, pricing, funding, eligibility, or policy claims.",
  ].join("\n\n");
}

export async function runGenxAgent(input: { userId?: number; agentKey: string; messages: ChatMessage[]; approvedKnowledge?: string; companyContext?: string }): Promise<GenxAgentResult> {
  const readiness = getGenxReadiness();
  const agent = AGENT_CATALOG.find(item => item.key === input.agentKey) ?? AGENT_CATALOG[1];
  const policy = getAgentPolicy(agent.key);
  const messages = compactAgentMessages(input.messages, policy);
  const approvedKnowledge = compactKnowledge(input.approvedKnowledge, policy);
  const companyContext = input.companyContext?.slice(0, 8_000);
  const model = getAgentModel(agent.key);
  const inputChars = messages.reduce((total, message) => total + message.content.length, 0) + (approvedKnowledge?.length ?? 0) + (companyContext?.length ?? 0);
  const requestHash = createAgentRequestHash({ agentKey: agent.key, messages, approvedKnowledge, companyContext, policy });

  if (input.userId && policy.cacheMinutes > 0) {
    const cached = await getCachedAgentResponse({ userId: input.userId, agentKey: agent.key, requestHash, policyVersion: policy.version });
    if (cached) {
      await recordAgentUsage({ userId: input.userId, agentKey: agent.key, model: model ?? null, cacheHit: true, inputChars, outputChars: cached.content.length });
      return { content: cached.content, provider: "genx", model: model ?? null, cacheHit: true };
    }
  }

  if (!readiness.ready || !model) {
    return { content: "Amarktai intelligence service is not connected yet. Add the GenX chat-completions URL, API key, and default model in deployment secrets; the selected specialist will then prepare review-ready guidance.", provider: "not_configured", model: model ?? null, cacheHit: false };
  }

  const systemMessage = { role: "system", content: buildAgentSystemPrompt({ agentName: agent.name, agentPurpose: agent.purpose, policy, companyContext, approvedKnowledge }) };

  const response = await fetch(process.env.GENX_CHAT_COMPLETIONS_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GENX_API_KEY!}` },
    body: JSON.stringify({ model, messages: [systemMessage, ...messages], temperature: policy.temperature, max_tokens: policy.maxResponseTokens }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`GenX request failed with ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ""}`);
  }

  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("GenX returned no assistant content.");
  const usage = { inputTokens: payload.usage?.prompt_tokens, outputTokens: payload.usage?.completion_tokens };

  if (input.userId) {
    await recordAgentUsage({ userId: input.userId, agentKey: agent.key, model, cacheHit: false, inputTokens: usage.inputTokens ?? null, outputTokens: usage.outputTokens ?? null, inputChars, outputChars: content.length });
    if (policy.cacheMinutes > 0) await saveCachedAgentResponse({ userId: input.userId, agentKey: agent.key, requestHash, policyVersion: policy.version, content, expiresAt: new Date(Date.now() + policy.cacheMinutes * 60_000) });
  }
  return { content, provider: "genx", model, cacheHit: false, usage };
}
