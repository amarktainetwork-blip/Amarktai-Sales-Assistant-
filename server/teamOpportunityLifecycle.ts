import { opportunityIsHistorical } from "./crm/actionExecutionPreconditions";
import { opportunityCountsAsWon } from "./salesTracker";

/**
 * Team reporting must exclude the same historical opportunity population as
 * Today, even when the client has not mapped every Lost/Rejected stage.
 * Preserve source-status precedence for Won value: a label alone cannot
 * convert an explicitly lost/open opportunity into a sale.
 */
export function teamOpportunityLifecycle(input: {
  stage: string | null;
  raw: unknown;
  closeAt: Date | null;
  mappedCategory?: string | null;
}) {
  const mappedWonStage =
    input.mappedCategory === "won" ||
    (!input.mappedCategory &&
      Boolean(
        input.stage &&
          /(^|\b)(closed[ _-]?won|won|sale[ _-]?complete|successful)(\b|$)/i.test(
            input.stage
          )
      ));
  const isWon = opportunityCountsAsWon({
    raw: input.raw,
    closeAt: input.closeAt,
    mappedWonStage,
  });
  const raw =
    input.raw && typeof input.raw === "object" && !Array.isArray(input.raw)
      ? (input.raw as Record<string, unknown>)
      : null;
  const isClosed =
    isWon ||
    input.mappedCategory === "won" ||
    input.mappedCategory === "lost" ||
    opportunityIsHistorical({ stage: input.stage || undefined, raw });
  return { isWon, isClosed };
}
