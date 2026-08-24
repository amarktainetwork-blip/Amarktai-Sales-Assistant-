import { createHash } from "node:crypto";

const inFlight = new Map<string, Promise<unknown>>();

export function tenantAiRequestKey(input: {
  organisationId: number;
  userId: number;
  agentKey: string;
  feature: string;
  model: string;
  promptVersion: string;
  knowledgeVersion: string;
  crmContextVersion: string;
  messages: unknown;
  approvedKnowledge?: string;
  workingContext?: string;
}) {
  const inputHash = createHash("sha256")
    .update(
      JSON.stringify({
        messages: input.messages,
        approvedKnowledge: input.approvedKnowledge || "",
        workingContext: input.workingContext || "",
      })
    )
    .digest("hex");
  return `${input.organisationId}:${input.userId}:${input.agentKey}:${input.feature}:${input.model}:${input.promptVersion}:${input.knowledgeVersion}:${input.crmContextVersion}:${inputHash}`;
}

/** Shares only an identical, tenant/user-scoped request while it is in flight. */
export function coalesceTenantAiRequest<T>(
  key: string,
  request: () => Promise<T>
): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const pending = request().finally(() => {
    if (inFlight.get(key) === pending) inFlight.delete(key);
  });
  inFlight.set(key, pending);
  return pending;
}
