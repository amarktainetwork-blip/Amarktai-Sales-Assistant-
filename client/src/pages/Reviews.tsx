import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { friendlyError } from "@/lib/friendlyError";
import {
  REVIEW_LIFECYCLE_COPY,
  reviewLifecycle,
  reviewResultDetail,
  type ReviewLifecycle,
} from "@/lib/reviewStatus";
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Loader2,
  Mail,
  Send,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

type ReviewItem = {
  id: number;
  actionType: string;
  title: string;
  targetLabel: string;
  state: string;
  payload: Record<string, unknown>;
  executionClaimId?: string | null;
  executionClaimedAt?: string | Date | null;
  executionResult?: Record<string, unknown> | null;
  createdAt?: string | Date | null;
  reviewedAt?: string | Date | null;
  executedAt?: string | Date | null;
};

type ReviewFilter =
  | "pending"
  | "ready"
  | "completed"
  | "skipped"
  | "blocked"
  | "failed"
  | "all";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function displayTime(value: unknown) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.valueOf())) return undefined;
  return date.toLocaleString();
}

function filterMatches(filter: ReviewFilter, lifecycle: ReviewLifecycle) {
  if (filter === "all") return true;
  if (filter === "ready")
    return lifecycle === "approved" || lifecycle === "executing";
  return filter === lifecycle;
}

function lifecycleTone(lifecycle: ReviewLifecycle) {
  if (lifecycle === "completed")
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (lifecycle === "failed")
    return "border-red-200 bg-red-50 text-red-800";
  if (lifecycle === "blocked")
    return "border-amber-200 bg-amber-50 text-amber-900";
  if (lifecycle === "skipped")
    return "border-slate-200 bg-slate-50 text-slate-700";
  if (lifecycle === "executing")
    return "border-blue-200 bg-blue-50 text-blue-800";
  return "border-[#C9D7E8] bg-[#F2F6FC] text-[#315EA8]";
}

function evidenceValue(value: unknown) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  return undefined;
}

function EvidenceDetails({ item }: { item: ReviewItem }) {
  const [open, setOpen] = useState(false);
  const audit = trpc.assistant.proposalAudit.useQuery(
    { proposalId: item.id },
    { enabled: open, retry: false }
  );
  const payload = object(item.payload);
  const route = object(payload.crmRoute);
  const context = object(payload.customerContext);
  const contentSource = object(payload.contentSource);
  const verification = object(payload.actionVerification);
  const compliance = object(payload.compliance);
  const duplicate = object(payload.duplicateVerification);
  const result = object(item.executionResult);
  const resultEvidence = object(result.evidence);
  const requiredPostconditions = Array.isArray(payload.requiredPostconditions)
    ? payload.requiredPostconditions
    : [];
  const executionOwner =
    text(payload.executionOwner) ||
    text(object(payload.executionOwner).owner) ||
    text(object(payload.executionOwner).provider) ||
    text(route.provider);
  const source =
    text(contentSource.label) ||
    text(contentSource.name) ||
    text(contentSource.templateName) ||
    text(contentSource.source) ||
    text(payload.templateName);

  return (
    <div className="mt-4 border-t border-[#E4EAF1] pt-4">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="flex w-full items-center justify-between gap-3 text-left text-xs font-bold text-[#40536B]"
      >
        <span>Evidence, safeguards and history</span>
        {open ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </button>
      {open ? (
        <div className="mt-3 space-y-4 text-xs leading-5 text-[#5D6D80]">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Evidence label="External customer ID" value={text(payload.contactExternalId) || text(context.contactExternalId)} />
            <Evidence label="Execution route" value={text(route.provider) || text(route.reason)} />
            <Evidence label="Execution owner" value={executionOwner} />
            <Evidence label="Content/template source" value={source} />
            <Evidence label="Target verified" value={evidenceValue(verification.targetVerified)} />
            <Evidence label="Recipient verified" value={evidenceValue(verification.recipientVerified)} />
            <Evidence label="Suppression verified" value={evidenceValue(compliance.suppressionVerified)} />
            <Evidence label="Duplicate state" value={evidenceValue(duplicate.state) || text(duplicate.rule)} />
            <Evidence label="Result provider" value={text(result.provider)} />
            <Evidence label="Correlation ID" value={text(result.correlationId)} />
            <Evidence label="Readback verified" value={evidenceValue(result.guardedReadbackVerified)} />
            <Evidence label="Duplicate prevented" value={evidenceValue(result.duplicatePrevented)} />
            <Evidence label="Screenshot evidence" value={text(resultEvidence.availability)} />
            <Evidence label="Reviewed" value={displayTime(item.reviewedAt)} />
            <Evidence label="Completed" value={displayTime(item.executedAt)} />
          </div>

          {requiredPostconditions.length ? (
            <div className="rounded-xl border border-[#DCE4EE] bg-[#F8FAFD] p-3">
              <p className="font-bold text-[#40536B]">Required postconditions</p>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {requiredPostconditions.map((value, index) => (
                  <li key={`${item.id}-post-${index}`}>{String(value)}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {text(result.detail) ? (
            <div className="rounded-xl border border-[#DCE4EE] bg-[#F8FAFD] p-3">
              <p className="font-bold text-[#40536B]">Recorded result</p>
              <p className="mt-1">{text(result.detail)}</p>
            </div>
          ) : null}

          <div className="rounded-xl border border-[#DCE4EE] bg-[#F8FAFD] p-3">
            <p className="font-bold text-[#40536B]">Decision and execution history</p>
            {audit.isLoading ? (
              <p className="mt-2">
                <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />
                Loading evidence…
              </p>
            ) : audit.isError ? (
              <p className="mt-2 text-amber-800">
                Audit evidence could not be loaded. The proposal itself has not been changed.
              </p>
            ) : audit.data?.length ? (
              <ol className="mt-2 space-y-2">
                {audit.data.map(entry => (
                  <li key={entry.id} className="border-l-2 border-[#C9D7E8] pl-3">
                    <p className="font-bold text-[#40536B]">{entry.summary}</p>
                    <p>{displayTime(entry.createdAt) || entry.eventType}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-2">No additional audit events are recorded yet.</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Evidence({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-2">
      <p className="font-bold text-[#40536B]">{label}</p>
      <p className="mt-0.5 break-words">{value || "Not recorded"}</p>
    </div>
  );
}

export default function Reviews() {
  const [, navigate] = useLocation();
  const actions = trpc.assistant.actions.useQuery(undefined, {
    retry: false,
    refetchInterval: 4_000,
  });
  const [error, setError] = useState("");
  const [draftBodies, setDraftBodies] = useState<Record<number, string>>({});
  const [filter, setFilter] = useState<ReviewFilter>("pending");

  const refresh = async () => {
    setError("");
    await actions.refetch();
  };

  const review = trpc.assistant.reviewAction.useMutation({
    onSuccess: async () => {
      await refresh();
      toast.success("Your decision was saved.");
    },
    onError: cause =>
      setError(
        friendlyError(
          cause,
          "That decision could not be saved. Nothing was changed."
        )
      ),
  });

  const execute = trpc.assistant.executeApprovedCrmAction.useMutation({
    onSuccess: async () => {
      await refresh();
      toast.success("The approved action completed and its result was recorded.");
    },
    onError: async cause => {
      await actions.refetch();
      setError(
        friendlyError(
          cause,
          "The approved action could not be verified. Review its recorded evidence before preparing another action."
        )
      );
    },
  });

  const editEmail = trpc.assistant.editEmailDraft.useMutation({
    onSuccess: async () => {
      await refresh();
      toast.success("Your edited draft was saved.");
    },
    onError: cause =>
      setError(
        friendlyError(cause, "That draft could not be saved. Nothing was sent.")
      ),
  });

  const sendEmail = trpc.assistant.sendReviewedEmail.useMutation({
    onSuccess: async () => {
      await refresh();
      toast.success("Email sent from your Microsoft mailbox and recorded.");
    },
    onError: async cause => {
      await actions.refetch();
      setError(
        friendlyError(
          cause,
          "The email was not verified as sent. Review the recorded evidence before retrying."
        )
      );
    },
  });

  const items = (actions.data ?? []) as ReviewItem[];
  const withLifecycle = useMemo(
    () => items.map(item => ({ item, lifecycle: reviewLifecycle(item) })),
    [items]
  );
  const counts = useMemo(() => {
    const result: Record<ReviewFilter, number> = {
      pending: 0,
      ready: 0,
      completed: 0,
      skipped: 0,
      blocked: 0,
      failed: 0,
      all: withLifecycle.length,
    };
    for (const entry of withLifecycle) {
      if (entry.lifecycle === "approved" || entry.lifecycle === "executing")
        result.ready += 1;
      else if (entry.lifecycle in result)
        result[entry.lifecycle as ReviewFilter] += 1;
    }
    return result;
  }, [withLifecycle]);
  const visible = withLifecycle.filter(entry =>
    filterMatches(filter, entry.lifecycle)
  );

  const filters: Array<{ key: ReviewFilter; label: string }> = [
    { key: "pending", label: "Pending" },
    { key: "ready", label: "Approved / executing" },
    { key: "completed", label: "Completed" },
    { key: "skipped", label: "Skipped" },
    { key: "blocked", label: "Blocked" },
    { key: "failed", label: "Failed" },
    { key: "all", label: "All" },
  ];

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-6xl space-y-5 text-[#26354A]">
        <header className="rounded-3xl border border-[#DCE4EE] bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[#3F70D8]">
                <ShieldCheck className="h-4 w-4" />
                <p className="text-[10px] font-black uppercase tracking-[.16em]">
                  Review
                </p>
              </div>
              <h1 className="mt-3 font-display text-4xl font-bold tracking-[-.06em] sm:text-5xl">
                One place to approve, apply and prove every action.
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[#66758A]">
                Pending work stays review-first. Approved work shows when it is executing. Completed, skipped, blocked and failed actions remain visible with the customer target, safeguards, readback and audit evidence that produced the final result.
              </p>
            </div>
            <Button variant="outline" onClick={() => navigate("/assistant")}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Assistant
            </Button>
          </div>
        </header>

        <section className="rounded-2xl border border-[#DCE4EE] bg-white p-3 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {filters.map(option => (
              <button
                key={option.key}
                type="button"
                onClick={() => setFilter(option.key)}
                className={`rounded-xl border px-3 py-2 text-xs font-bold transition ${
                  filter === option.key
                    ? "border-[#3F70D8] bg-[#EDF4FF] text-[#315EA8]"
                    : "border-[#DCE4EE] bg-white text-[#66758A] hover:border-[#B8C7D9]"
                }`}
              >
                {option.label} · {counts[option.key]}
              </button>
            ))}
          </div>
        </section>

        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            {error}
          </p>
        ) : null}

        {actions.isLoading ? (
          <section className="grid min-h-48 place-items-center rounded-3xl border border-[#DCE4EE] bg-white text-sm text-[#66758A] shadow-sm">
            <span>
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
              Loading Review history…
            </span>
          </section>
        ) : actions.isError ? (
          <section className="rounded-3xl border border-[#DCE4EE] bg-white p-7 text-center shadow-sm">
            <ShieldAlert className="mx-auto h-8 w-8 text-amber-600" />
            <h2 className="mt-4 font-display text-2xl font-bold">
              Review could not be loaded.
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[#66758A]">
              Nothing has been changed. Restore the workspace connection and reload Review.
            </p>
            <Button className="mt-5" onClick={() => void actions.refetch()}>
              Try again
            </Button>
          </section>
        ) : visible.length ? (
          <section className="space-y-4">
            {visible.map(({ item, lifecycle }) => {
              const payload = object(item.payload);
              const route = object(payload.crmRoute);
              const mailboxDraft =
                route.provider === "microsoft_delegated" &&
                ["send_email", "send_email_template"].includes(item.actionType);
              const draftBody =
                draftBodies[item.id] ??
                text(payload.body) ??
                text(payload.templateText) ??
                "";
              const destination =
                text(payload.to) || text(payload.email) || text(payload.phone);
              const subject = text(payload.subject);
              const sender = text(payload.senderIdentity);
              const why = text(payload.why);
              const resultDetail = reviewResultDetail(item);
              const statusCopy = REVIEW_LIFECYCLE_COPY[lifecycle];

              return (
                <article
                  key={item.id}
                  className="rounded-3xl border border-[#DCE4EE] bg-white p-5 shadow-sm sm:p-6"
                >
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-[.08em] ${lifecycleTone(lifecycle)}`}
                        >
                          {lifecycle === "executing" ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : lifecycle === "completed" ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : lifecycle === "failed" || lifecycle === "blocked" ? (
                            <ShieldAlert className="h-3 w-3" />
                          ) : lifecycle === "approved" ? (
                            <Check className="h-3 w-3" />
                          ) : lifecycle === "skipped" ? (
                            <X className="h-3 w-3" />
                          ) : (
                            <ShieldCheck className="h-3 w-3" />
                          )}
                          {statusCopy.label}
                        </span>
                        <span className="text-xs text-[#8190A3]">
                          #{item.id} · {item.actionType.replaceAll("_", " ")}
                        </span>
                      </div>

                      <h2 className="mt-3 font-display text-2xl font-bold tracking-[-.04em]">
                        {item.title}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-[#66758A]">
                        Customer: <span className="font-bold text-[#40536B]">{item.targetLabel}</span>
                      </p>
                      <p className="mt-1 text-xs leading-5 text-[#8190A3]">
                        {resultDetail || statusCopy.description}
                      </p>

                      {destination || subject || sender ? (
                        <div className="mt-4 grid gap-3 rounded-2xl border border-[#DCE4EE] bg-[#F7F9FC] p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                          {destination ? (
                            <p>
                              <span className="font-bold text-[#33445B]">Recipient</span>
                              <br />
                              {destination}
                            </p>
                          ) : null}
                          {sender ? (
                            <p>
                              <span className="font-bold text-[#33445B]">Sender</span>
                              <br />
                              {sender}
                            </p>
                          ) : null}
                          {subject ? (
                            <p>
                              <span className="font-bold text-[#33445B]">Subject</span>
                              <br />
                              {subject}
                            </p>
                          ) : null}
                        </div>
                      ) : null}

                      {mailboxDraft && lifecycle === "pending" ? (
                        <div className="mt-4 rounded-2xl border border-[#DCE4EE] bg-[#F7F9FC] p-4">
                          {why ? (
                            <div className="mb-3 rounded-xl border border-[#DCE4EE] bg-white p-3 text-xs leading-5 text-[#66758A]">
                              <p className="font-bold text-[#40536B]">Why a reply is needed</p>
                              <p className="mt-1">{why}</p>
                            </div>
                          ) : null}
                          <label className="block text-xs font-bold text-[#526277]">
                            Draft reply
                            <Textarea
                              value={draftBody}
                              onChange={event =>
                                setDraftBodies(current => ({
                                  ...current,
                                  [item.id]: event.target.value,
                                }))
                              }
                              className="mt-2 min-h-44 bg-white text-sm font-normal leading-6"
                            />
                          </label>
                        </div>
                      ) : text(payload.body) || text(payload.templateText) ? (
                        <div className="mt-4 max-h-48 overflow-auto whitespace-pre-wrap rounded-2xl border border-[#DCE4EE] bg-[#F7F9FC] p-4 text-sm leading-6 text-[#526277]">
                          {text(payload.body) || text(payload.templateText)}
                        </div>
                      ) : null}

                      <EvidenceDetails item={item} />
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2 lg:max-w-48 lg:flex-col">
                      {lifecycle === "pending" && mailboxDraft ? (
                        <>
                          <Button
                            variant="outline"
                            disabled={review.isPending || sendEmail.isPending}
                            onClick={() =>
                              review.mutate({
                                proposalId: item.id,
                                state: "skipped",
                              })
                            }
                          >
                            <X className="mr-2 h-4 w-4" />
                            Dismiss
                          </Button>
                          <Button
                            variant="outline"
                            disabled={editEmail.isPending || !draftBody.trim()}
                            onClick={() =>
                              editEmail.mutate({
                                proposalId: item.id,
                                body: draftBody,
                              })
                            }
                          >
                            <Mail className="mr-2 h-4 w-4" />
                            Save edit
                          </Button>
                          <Button
                            disabled={sendEmail.isPending || !draftBody.trim()}
                            onClick={() =>
                              sendEmail.mutate({
                                proposalId: item.id,
                                body: draftBody,
                              })
                            }
                          >
                            {sendEmail.isPending ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Send className="mr-2 h-4 w-4" />
                            )}
                            Send email
                          </Button>
                        </>
                      ) : lifecycle === "pending" ? (
                        <>
                          <Button
                            variant="outline"
                            disabled={review.isPending}
                            onClick={() =>
                              review.mutate({
                                proposalId: item.id,
                                state: "skipped",
                              })
                            }
                          >
                            <X className="mr-2 h-4 w-4" />
                            Skip
                          </Button>
                          <Button
                            disabled={review.isPending}
                            onClick={() =>
                              review.mutate({
                                proposalId: item.id,
                                state: "approved",
                              })
                            }
                          >
                            {review.isPending ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Check className="mr-2 h-4 w-4" />
                            )}
                            Approve change
                          </Button>
                        </>
                      ) : lifecycle === "approved" ? (
                        <Button
                          disabled={execute.isPending}
                          onClick={() => execute.mutate({ proposalId: item.id })}
                        >
                          {execute.isPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Check className="mr-2 h-4 w-4" />
                          )}
                          Apply approved change
                        </Button>
                      ) : lifecycle === "executing" ? (
                        <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold leading-5 text-blue-800">
                          <Clock3 className="mr-1.5 inline h-3.5 w-3.5" />
                          Applying and verifying readback
                        </div>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        ) : (
          <section className="rounded-3xl border border-dashed border-[#C9D4E2] bg-white p-10 text-center shadow-sm">
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
            <h2 className="mt-4 font-display text-2xl font-bold">
              No {filters.find(option => option.key === filter)?.label.toLowerCase()} actions.
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[#66758A]">
              Change the Review filter to inspect action history, or return to the Assistant to prepare new work.
            </p>
            <Button className="mt-5" onClick={() => navigate("/assistant")}>
              Open Assistant
            </Button>
          </section>
        )}
      </div>
    </DashboardLayout>
  );
}
