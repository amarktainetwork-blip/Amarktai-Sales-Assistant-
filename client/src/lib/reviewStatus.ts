export const REVIEW_EXECUTION_CLAIM_TTL_MS = 15 * 60 * 1000;

export type ReviewLifecycle =
  | "pending"
  | "approved"
  | "executing"
  | "completed"
  | "skipped"
  | "blocked"
  | "failed";

export type ReviewProposalLike = {
  state: string;
  executionClaimId?: string | null;
  executionClaimedAt?: string | Date | null;
  executionResult?: Record<string, unknown> | null;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function reviewLifecycle(
  proposal: ReviewProposalLike,
  nowMs = Date.now()
): ReviewLifecycle {
  if (proposal.state === "review_required") return "pending";
  if (proposal.state === "approved") {
    const claimedAt = proposal.executionClaimedAt
      ? new Date(proposal.executionClaimedAt).valueOf()
      : Number.NaN;
    const activeClaim = Boolean(
      proposal.executionClaimId &&
        Number.isFinite(claimedAt) &&
        nowMs - claimedAt < REVIEW_EXECUTION_CLAIM_TTL_MS
    );
    return activeClaim ? "executing" : "approved";
  }
  if (proposal.state === "executed") return "completed";
  if (proposal.state === "skipped") return "skipped";
  if (proposal.state === "blocked") {
    const result = object(proposal.executionResult);
    return result.success === false ? "failed" : "blocked";
  }
  return "blocked";
}

export const REVIEW_LIFECYCLE_COPY: Record<
  ReviewLifecycle,
  { label: string; description: string }
> = {
  pending: {
    label: "Pending",
    description: "Waiting for your decision.",
  },
  approved: {
    label: "Approved",
    description: "Approved and ready to apply.",
  },
  executing: {
    label: "Executing",
    description: "Amarktai is applying the approved action and verifying readback.",
  },
  completed: {
    label: "Completed",
    description: "The action completed and its result was recorded.",
  },
  skipped: {
    label: "Skipped",
    description: "You chose not to apply this proposal.",
  },
  blocked: {
    label: "Blocked",
    description: "A required target, permission, route or precondition was not proven.",
  },
  failed: {
    label: "Failed",
    description: "Execution was attempted but a successful verified result was not recorded.",
  },
};

export function reviewResultDetail(proposal: ReviewProposalLike) {
  const result = object(proposal.executionResult);
  return typeof result.detail === "string" ? result.detail : undefined;
}
