import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { friendlyError } from "@/lib/friendlyError";
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Loader2,
  Mail,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

export default function Reviews() {
  const [, navigate] = useLocation();
  const dashboard = trpc.assistant.dashboard.useQuery(undefined, {
    retry: false,
  });
  const [error, setError] = useState("");
  const [draftBodies, setDraftBodies] = useState<Record<number, string>>({});

  const review = trpc.assistant.reviewAction.useMutation({
    onSuccess: async () => {
      setError("");
      await dashboard.refetch();
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
      setError("");
      await dashboard.refetch();
      toast.success("The approved CRM change was completed.");
    },
    onError: async cause => {
      await dashboard.refetch();
      setError(
        friendlyError(
          cause,
          "The approved CRM change could not be completed. Check the CRM connection and try again."
        )
      );
    },
  });
  const editEmail = trpc.assistant.editEmailDraft.useMutation({
    onSuccess: async () => {
      setError("");
      await dashboard.refetch();
      toast.success("Your edited draft was saved.");
    },
    onError: cause =>
      setError(
        friendlyError(cause, "That draft could not be saved. Nothing was sent.")
      ),
  });
  const sendEmail = trpc.assistant.sendReviewedEmail.useMutation({
    onSuccess: async () => {
      setError("");
      await dashboard.refetch();
      toast.success("Email sent from your Microsoft mailbox.");
    },
    onError: async cause => {
      await dashboard.refetch();
      setError(
        friendlyError(
          cause,
          "The email was not sent. Check your Microsoft mailbox connection and try again."
        )
      );
    },
  });

  const items = dashboard.data?.proposals ?? [];
  const pending = items.filter(item =>
    ["review_required", "approved"].includes(item.state)
  );

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-5xl space-y-6 text-[#26354A]">
        <header className="rounded-3xl border border-[#DCE4EE] bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[#3F70D8]">
                <ShieldCheck className="h-4 w-4" />
                <p className="text-[10px] font-black uppercase tracking-[.16em]">
                  Review changes
                </p>
              </div>
              <h1 className="mt-3 font-display text-4xl font-bold tracking-[-.06em] sm:text-5xl">
                You decide what changes in your CRM.
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#66758A]">
                Check each proposed change before it is applied. Nothing is sent
                or changed until you approve it and choose to continue.
              </p>
            </div>
            <Button variant="outline" onClick={() => navigate("/assistant")}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Assistant
            </Button>
          </div>
        </header>

        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            {error}
          </p>
        ) : null}

        {dashboard.isLoading ? (
          <section className="grid min-h-48 place-items-center rounded-3xl border border-[#DCE4EE] bg-white text-sm text-[#66758A] shadow-sm">
            <span>
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
              Loading proposed changes…
            </span>
          </section>
        ) : dashboard.isError ? (
          <section className="rounded-3xl border border-[#DCE4EE] bg-white p-7 text-center shadow-sm">
            <h2 className="font-display text-2xl font-bold">
              Proposed changes could not be loaded.
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[#66758A]">
              Nothing has been changed. Check your connection and try again.
            </p>
            <Button className="mt-5" onClick={() => void dashboard.refetch()}>
              Try again
            </Button>
          </section>
        ) : pending.length ? (
          <section className="space-y-4">
            {pending.map(item => {
              const payload = item.payload as Record<string, unknown>;
              const route = payload.crmRoute as
                | { provider?: string }
                | undefined;
              const mailboxDraft =
                route?.provider === "microsoft_delegated" &&
                ["send_email", "send_email_template"].includes(item.actionType);
              const draftBody =
                draftBodies[item.id] ??
                (typeof payload.body === "string" ? payload.body : "");
              return (
                <article
                  key={item.id}
                  className="rounded-3xl border border-[#DCE4EE] bg-white p-5 shadow-sm sm:p-6"
                >
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {item.state === "approved" ? (
                          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                        ) : (
                          <ShieldCheck className="h-5 w-5 shrink-0 text-[#3F70D8]" />
                        )}
                        <p className="text-xs font-bold text-[#718096]">
                          {item.state === "approved"
                            ? "Approved — ready to apply"
                            : "Your approval is required"}
                        </p>
                      </div>
                      <h2 className="mt-3 font-display text-2xl font-bold tracking-[-.04em]">
                        {item.title}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-[#66758A]">
                        Customer: {item.targetLabel}
                      </p>
                      {mailboxDraft ? (
                        <div className="mt-5 space-y-4 rounded-2xl border border-[#DCE4EE] bg-[#F7F9FC] p-4">
                          <div className="grid gap-3 text-sm sm:grid-cols-2">
                            <p>
                              <span className="font-bold text-[#33445B]">
                                Recipient
                              </span>
                              <br />
                              {String(payload.to || "")}
                            </p>
                            <p>
                              <span className="font-bold text-[#33445B]">
                                Subject
                              </span>
                              <br />
                              {String(payload.subject || "")}
                            </p>
                            <p className="sm:col-span-2">
                              <span className="font-bold text-[#33445B]">
                                Why a reply is needed
                              </span>
                              <br />
                              {String(
                                payload.why ||
                                  "The customer asked for a response."
                              )}
                            </p>
                          </div>
                          <label className="block text-xs font-bold text-[#526277]">
                            Draft reply
                            <Textarea
                              value={draftBody}
                              disabled={item.state !== "review_required"}
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
                      ) : null}
                    </div>

                    {item.state === "review_required" && mailboxDraft ? (
                      <div className="flex shrink-0 flex-wrap gap-2 sm:max-w-44">
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
                      </div>
                    ) : item.state === "review_required" ? (
                      <div className="flex shrink-0 flex-wrap gap-2">
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
                      </div>
                    ) : (
                      <Button
                        className="shrink-0"
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
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        ) : (
          <section className="rounded-3xl border border-dashed border-[#C9D4E2] bg-white p-10 text-center shadow-sm">
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
            <h2 className="mt-4 font-display text-2xl font-bold">
              Nothing is waiting for approval.
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[#66758A]">
              Ask the Assistant for the next sales task or customer follow-up.
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
