import {
  TELESALES_OUTCOMES,
  type TelesalesOutcome,
} from "../telesales/closeoutPlanner";

export type ParsedLiveCallCompletion =
  | { ok: false }
  | {
      ok: true;
      callSessionId: number;
      transcript: string;
      outcome: TelesalesOutcome;
    };

/** Validates structured closeout fields without inventing transcript text. */
export function parseLiveCallCompletion(
  value: unknown
): ParsedLiveCallCompletion {
  const body =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const callSessionId = Number(body.callSessionId);
  const transcript =
    typeof body.transcript === "string"
      ? body.transcript.trim().slice(-40_000)
      : "";
  const outcome =
    typeof body.outcome === "string" &&
    TELESALES_OUTCOMES.includes(body.outcome as TelesalesOutcome)
      ? (body.outcome as TelesalesOutcome)
      : undefined;
  if (!Number.isInteger(callSessionId) || callSessionId <= 0 || !outcome)
    return { ok: false };
  return { ok: true, callSessionId, transcript, outcome };
}
