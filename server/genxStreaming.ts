import { AGENT_CATALOG } from "./agentCatalog";
import { consumeAiCredits, getAiCreditWallet } from "./aiCredits";
import { assertModelSpendAllowed } from "./aiExecutionBoundary";
import {
  getGenxReadiness,
  type ChatMessage,
  type GenxBillingContext,
  type GenxUsage,
} from "./genx";

type StreamChunk = {
  choices?: Array<{
    delta?: { content?: string };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
};

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function featureEnvKey(feature: string) {
  return `AI_CREDIT_COST_${feature
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase()}`;
}
function creditCost(billing: GenxBillingContext) {
  if (Number.isInteger(billing.creditCost) && (billing.creditCost || 0) >= 0)
    return Math.min(10_000, billing.creditCost || 0);
  return Math.min(
    10_000,
    positiveInt(
      process.env[featureEnvKey(billing.feature)],
      positiveInt(process.env.AI_CREDIT_COST_DEFAULT, 1)
    )
  );
}

function boundedMessages(messages: ChatMessage[], maxChars: number) {
  const selected: ChatMessage[] = [];
  let remaining = maxChars;
  for (
    let index = messages.length - 1;
    index >= 0 && remaining > 0;
    index -= 1
  ) {
    const message = messages[index];
    const content = message.content.trim();
    if (!content) continue;
    const slice =
      content.length > remaining
        ? content.slice(content.length - remaining)
        : content;
    selected.unshift({ role: message.role, content: slice });
    remaining -= slice.length;
  }
  return selected;
}

export async function streamGenxAgent(input: {
  agentKey: string;
  messages: ChatMessage[];
  workingContext?: string;
  billing: GenxBillingContext;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  onDelta: (delta: string) => void | Promise<void>;
}) {
  assertModelSpendAllowed("genx", input.billing.feature);
  const readiness = getGenxReadiness();
  if (!readiness.configured)
    throw new Error("Amarktai intelligence is not connected.");
  const billingEnabled = process.env.AI_BILLING_ENABLED === "true";
  const charge = billingEnabled ? creditCost(input.billing) : 0;
  let billingExempt = !billingEnabled;
  if (billingEnabled && charge > 0) {
    const wallet = await getAiCreditWallet({
      userId: input.billing.userId,
      organisationId: input.billing.organisationId,
    });
    billingExempt = wallet.billingExempt;
    if (!billingExempt && wallet.balance < charge)
      throw new Error(
        `This AI operation needs ${charge} Amarktai AI Credit${charge === 1 ? "" : "s"}, but the organisation has ${wallet.balance} remaining.`
      );
  }

  const agent =
    AGENT_CATALOG.find(item => item.key === input.agentKey) ?? AGENT_CATALOG[1];
  const model =
    process.env.GENX_FAST_MODEL?.trim() || process.env.GENX_DEFAULT_MODEL!.trim();
  const workingContext = input.workingContext?.trim().slice(0, 10_000);
  const messages = boundedMessages(input.messages, 10_000);
  const systemMessage = {
    role: "system" as const,
    content: `You are ${agent.name}, a governed capability inside Amarktai Sales Assistant. ${agent.purpose} Never claim an external action happened unless confirmed. Never invent customer facts, commitments, prices, policy or product details. Give concise, immediately useful guidance.${workingContext ? `\n\nCurrent approved working context:\n${workingContext}` : ""}`,
  };

  const timeoutSignal = AbortSignal.timeout(30_000);
  const signal = input.signal
    ? AbortSignal.any([input.signal, timeoutSignal])
    : timeoutSignal;
  const startedAt = Date.now();
  const response = await fetch(process.env.GENX_CHAT_COMPLETIONS_URL!, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GENX_API_KEY!}`,
    },
    body: JSON.stringify({
      model,
      messages: [systemMessage, ...messages],
      temperature: 0.15,
      max_tokens: Math.min(500, Math.max(80, input.maxOutputTokens || 180)),
      stream: true,
    }),
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `GenX streaming request failed with ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ""}`
    );
  }
  if (!response.body) throw new Error("GenX streaming response had no body.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let firstDeltaMs: number | undefined;
  let usage: GenxUsage = {};

  const processEvent = async (event: string) => {
    for (const line of event.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let parsed: StreamChunk;
      try {
        parsed = JSON.parse(data) as StreamChunk;
      } catch {
        continue;
      }
      const delta = parsed.choices?.[0]?.delta?.content || "";
      if (delta) {
        if (firstDeltaMs === undefined) firstDeltaMs = Date.now() - startedAt;
        content += delta;
        await input.onDelta(delta);
      }
      if (parsed.usage)
        usage = {
          promptTokens:
            parsed.usage.prompt_tokens ?? parsed.usage.input_tokens,
          completionTokens:
            parsed.usage.completion_tokens ?? parsed.usage.output_tokens,
          totalTokens: parsed.usage.total_tokens,
        };
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const event = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      await processEvent(event);
      boundary = buffer.indexOf("\n\n");
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) await processEvent(buffer);

  const finalContent = content.trim();
  if (!finalContent)
    throw new Error("GenX returned no streamed assistant content.");

  if (billingEnabled)
    await consumeAiCredits({
      userId: input.billing.userId,
      organisationId: input.billing.organisationId,
      credits: charge,
      feature: input.billing.feature,
      model,
      providerUsage: { ...usage },
      reference: input.billing.reference,
    });

  return {
    content: finalContent,
    provider: "genx" as const,
    model,
    usage,
    creditsCharged: !billingExempt ? charge : 0,
    firstDeltaMs,
    durationMs: Date.now() - startedAt,
  };
}
