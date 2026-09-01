import { isGovernedEvidenceAgent } from "./governedEvidenceAgents";

export function evaluateProductionAgentProbe(input: {
  agentKey: string;
  provider: string;
  content: string;
}) {
  if (isGovernedEvidenceAgent(input.agentKey)) {
    if (input.provider !== "workspace_evidence_blocked")
      throw new Error(
        `Governed evidence agent bypassed its authenticated workspace boundary with provider ${input.provider}.`
      );
    return {
      status: "AUTHENTICATED_WORKSPACE_GUARD_PROVEN" as const,
      provider: input.provider,
      genxTransportVerifiedSeparately: true,
    };
  }

  if (input.provider !== "genx")
    throw new Error(
      `Agent used provider ${input.provider} instead of the configured production intelligence service.`
    );
  if (!input.content.trim()) throw new Error("Agent returned no content.");
  return {
    status: "GENX_LIVE_PROVEN" as const,
    provider: input.provider,
    responseCharacters: input.content.trim().length,
  };
}
