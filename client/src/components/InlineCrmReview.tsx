import { Button } from "@/components/ui/button";
import { friendlyError } from "@/lib/friendlyError";
import {
  REVIEW_LIFECYCLE_COPY,
  reviewLifecycle,
  reviewResultDetail,
} from "@/lib/reviewStatus";
import { trpc } from "@/lib/trpc";
import {
  Check,
  CheckCircle2,
  ExternalLink,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function compact(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export default function InlineCrmReview({
  workflowRunId,
}: {
  workflowRunId: number | null;
}) {
  const [, navigate] = useLocation();
  const actions = trpc.assistant.actions.useQuery(
    workflowRunId ? { workflowRunId } : undefined,
    {
      enabled: Boolean(workflowRunId),
      retry: false,
      refetchInterval: workflowRunId ? 2_500 : false,
    }
  );
  const review = trpc.assistant.reviewAction.useMutation({
    onSuccess: async () => {
      await actions.refetch();
      toast.success("Review decision saved.");
    },
    onError: error =>
      toast.error(
        friendlyError(error, "That review decision could not be saved.")
      ),
  });
  const execute = trpc.assistant.executeApprovedCrmAction.useMutation({
    onSuccess: async () => {
      await actions.refetch();
      toast.success("Approved action completed and verified.");
    },
    onError: async error => {
      await actions.refetch();
      toast.error(
        friendlyError(
          error,
          "The approved action could not be completed. Review its evidence before trying anything else."
        )
      );
    },
  });

  if (!workflowRunId) return null;

  const items = actions.data ?? [];
  return (
    <section className="mt-3 rounded-xl border border-[#C9D7E8] bg-[#F7FAFE] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[.12em] text-[#3F70D8]">
            <ShieldCheck className="h-3.5 w-3.5" />
            Review
          </p>
          <p className="mt-1 text-xs leading-5 text-[#66758A]">
            These are the exact governed actions prepared from this CRM context.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 shrink-0"
          onClick={() => navigate("/reviews")}
        >
          Full Review
          <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
        </Button>
      </div>

      {actions.isLoading ? (
        <p className="mt-3 text-xs text-[#66758A]">
          <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />
          Loading prepared actions…
        </p>
      ) : actions.isError ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs leading-5 text-amber-900">
          <ShieldAlert className="mr-1.5 inline h-3.5 w-3.5" />
          The action state could not be refreshed. Nothing new will be applied from this panel until Review is available again.
        </div>
      ) : items.length === 0 ? (
        <p className="mt-3 text-xs text-[#66758A]">
          No reviewable action was created for this instruction.
        </p>
      ) : (
        <div className="mt-3 space-y-2.5">
          {items.map(item => {
            const lifecycle = reviewLifecycle(item);
            const copy = REVIEW_LIFECYCLE_COPY[lifecycle];
            const payload = object(item.payload);
            const route = object(payload.crmRoute);
            const email =
              route.provider === "microsoft_delegated" &&
              ["send_email", "send_email_template"].includes(item.actionType);
            const resultDetail = reviewResultDetail(item);
            const body = compact(
              payload.body ?? payload.templateText ?? payload.message
            );
            const subject = compact(payload.subject);
            const destination = compact(payload.to ?? payload.email ?? payload.phone);

            return (
              <article
                key={item.id}
                className="rounded-lg border border-[#D7E0EA] bg-white p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-[#3F70D8]">
                      {copy.label}
                    </p>
                    <p className="mt-0.5 text-sm font-bold leading-5 text-[#26354A]">
                      {item.title}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-[#66758A]">
                      Customer: {item.targetLabel}
                    </p>
                  </div>
                  {lifecycle === "completed" ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  ) : lifecycle === "failed" || lifecycle === "blocked" ? (
                    <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" />
                  ) : (
                    <ShieldCheck className="h-4 w-4 shrink-0 text-[#3F70D8]" />
                  )}
                </div>

                {destination || subject || body ? (
                  <div className="mt-2 rounded-md bg-[#F7F9FC] p-2 text-xs leading-5 text-[#526277]">
                    {destination ? <p>To: {destination}</p> : null}
                    {subject ? <p>Subject: {subject}</p> : null}
                    {body ? (
                      <p className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap">
                        {body}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <p className="mt-2 text-xs leading-5 text-[#66758A]">
                  {resultDetail || copy.description}
                </p>

                {lifecycle === "pending" ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      disabled={review.isPending}
                      onClick={() =>
                        review.mutate({ proposalId: item.id, state: "skipped" })
                      }
                    >
                      <X className="mr-1.5 h-3.5 w-3.5" />
                      Skip
                    </Button>
                    {email ? (
                      <Button
                        size="sm"
                        className="h-8"
                        onClick={() => navigate("/reviews")}
                      >
                        Review email
                        <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className="h-8"
                        disabled={review.isPending}
                        onClick={() =>
                          review.mutate({
                            proposalId: item.id,
                            state: "approved",
                          })
                        }
                      >
                        {review.isPending ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Approve
                      </Button>
                    )}
                  </div>
                ) : lifecycle === "approved" ? (
                  <Button
                    size="sm"
                    className="mt-2 h-8"
                    disabled={execute.isPending}
                    onClick={() => execute.mutate({ proposalId: item.id })}
                  >
                    {execute.isPending ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Apply approved action
                  </Button>
                ) : lifecycle === "executing" ? (
                  <p className="mt-2 text-xs font-bold text-[#3F70D8]">
                    <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />
                    Applying and checking CRM readback…
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
