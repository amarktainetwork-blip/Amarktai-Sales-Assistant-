import { AGENT_CATALOG } from "./agentCatalog";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export function getGenxReadiness() {
  const endpointConfigured = Boolean(process.env.GENX_CHAT_COMPLETIONS_URL);
  const keyConfigured = Boolean(process.env.GENX_API_KEY);
  const modelConfigured = Boolean(process.env.GENX_DEFAULT_MODEL);
  return {
    ready: endpointConfigured && keyConfigured && modelConfigured,
    endpointConfigured,
    keyConfigured,
    modelConfigured,
  };
}

export async function runGenxAgent(input: { agentKey: string; messages: ChatMessage[]; approvedKnowledge?: string }) {
  const readiness = getGenxReadiness();
  const agent = AGENT_CATALOG.find(item => item.key === input.agentKey) ?? AGENT_CATALOG[1];

  if (!readiness.ready) {
    return {
      content:
        "GenX is not connected yet. Add the GenX chat-completions URL, API key, and default model in deployment secrets; the assistant will then route this request through the selected agent.",
      provider: "not_configured" as const,
    };
  }

  const systemMessage = {
    role: "system",
    content: `You are ${agent.name} for Course2Career. ${agent.purpose} Never claim that an external CRM, email, SMS, WhatsApp, or calendar action happened unless the system confirms it. Never invent candidate facts, objections, commitments, or programme details. Produce concise, review-ready guidance.${input.approvedKnowledge ? `\n\nApproved knowledge sources for this answer:\n${input.approvedKnowledge}\n\nTreat these sources as the only authority for programme, policy, pricing, entry requirement or course claims. If the answer is not present, say so clearly.` : ""}`,
  };

  const response = await fetch(process.env.GENX_CHAT_COMPLETIONS_URL!, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GENX_API_KEY!}`,
    },
    body: JSON.stringify({
      model: process.env.GENX_DEFAULT_MODEL,
      messages: [systemMessage, ...input.messages],
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`GenX request failed with ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ""}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("GenX returned no assistant content.");

  return { content, provider: "genx" as const };
}
