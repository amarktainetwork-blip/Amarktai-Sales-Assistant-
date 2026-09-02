import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ContactRound,
  Download,
  Headphones,
  LibraryBig,
  MessageSquareText,
  ShieldCheck,
  Star,
  Trash2,
  Volume2,
  Workflow,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

const workflows = [
  {
    key: "first_contact",
    title: "First contact sequence",
    text: "Prepare an approved initial-contact and follow-up path.",
  },
  {
    key: "post_consultation_follow_up",
    title: "Post-consultation follow-up",
    text: "Turn a verified conversation result into a reviewable next step.",
  },
  {
    key: "final_close",
    title: "Final close review",
    text: "Prepare a protected closure sequence for the current record.",
  },
] as const;
type WorkflowKey = (typeof workflows)[number]["key"];

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <DashboardLayout>
      <div className="mx-auto max-w-6xl text-[#EEF5FF]">{children}</div>
    </DashboardLayout>
  );
}
function Panel({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-[1.5rem] border border-white/10 bg-[#0E2142] p-5 shadow-[0_18px_40px_rgba(0,0,0,.16)] sm:p-6">
      {children}
    </section>
  );
}
function Header({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string;
  title: string;
  text: string;
}) {
  return (
    <header className="border-b border-white/10 pb-7">
      <p className="text-[10px] font-black uppercase tracking-[.16em] text-[#83AEFF]">
        {eyebrow}
      </p>
      <h1 className="mt-3 font-display text-4xl font-bold tracking-[-.07em] text-white sm:text-5xl">
        {title}
      </h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-[#A9BFDF]">{text}</p>
    </header>
  );
}

export function CommandCentre() {
  const dashboard = trpc.assistant.dashboard.useQuery();
  const savedItems = trpc.assistant.savedItems.list.useQuery();
  const [tagDraft, setTagDraft] = useState("");
  const review = trpc.assistant.reviewAction.useMutation({
    onSuccess: () => {
      dashboard.refetch();
      toast.success("Proposal updated.");
    },
    onError: error => toast.error(`Review update failed: ${error.message}`),
  });
  const execute = trpc.assistant.executeApprovedCrmAction.useMutation({
    onSuccess: () => {
      dashboard.refetch();
      toast.success("Action completed and evidence recorded.");
    },
    onError: error => {
      dashboard.refetch();
      toast.error(`Action failed: ${error.message}`);
    },
  });
  const saveItem = trpc.assistant.savedItems.save.useMutation({
    onSuccess: () => {
      savedItems.refetch();
      toast.success("Saved to workspace favorites.");
    },
    onError: error => toast.error(`Could not save item: ${error.message}`),
  });
  const removeItem = trpc.assistant.savedItems.remove.useMutation({
    onSuccess: () => {
      savedItems.refetch();
      toast.success("Removed from saved items.");
    },
    onError: error => toast.error(`Could not remove item: ${error.message}`),
  });
  const tags = tagDraft
    .split(",")
    .map(tag => tag.trim())
    .filter(Boolean);
  if (dashboard.isLoading)
    return (
      <Frame>
        <Panel>
          <p className="text-sm text-[#A9BFDF]">
            Loading controlled workspace proposals…
          </p>
        </Panel>
      </Frame>
    );
  if (dashboard.isError)
    return (
      <Frame>
        <Panel>
          <p className="font-bold text-rose-100">
            The review queue could not load.
          </p>
          <p className="mt-2 text-sm text-rose-100/80">
            {dashboard.error.message ||
              "Check your connection and selected organisation, then retry."}
          </p>
          <Button
            onClick={() => dashboard.refetch()}
            className="mt-4 bg-[#1B64F2]"
          >
            Retry review queue
          </Button>
        </Panel>
      </Frame>
    );
  const items = dashboard.data?.proposals ?? [];
  return (
    <Frame>
      <Header
        eyebrow="APPROVALS"
        title="Keep every decision in view."
        text="See what will change, approve or skip it, and review the CRM result and time. Save priority pitches or leads with your own workspace tags."
      />
      <div className="mt-7 grid gap-4 md:grid-cols-3">
        {[
          [
            "Review required",
            dashboard.data?.metrics.actionsAwaitingReview ?? 0,
          ],
          ["Open callbacks", dashboard.data?.metrics.openCallbackTasks ?? 0],
          ["Approved knowledge", dashboard.data?.metrics.knowledgeSources ?? 0],
        ].map(([label, value]) => (
          <Panel key={String(label)}>
            <p className="text-sm text-[#A9BFDF]">{label}</p>
            <p className="mt-2 text-4xl font-bold text-white">{value}</p>
          </Panel>
        ))}
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.25fr_.75fr]">
        <Panel>
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-[#83AEFF]" />
            <p className="text-xs font-black uppercase tracking-[.14em] text-[#83AEFF]">
              Work ready for review
            </p>
          </div>
          <label className="mt-4 block text-xs font-bold text-[#A9BFDF]">
            Tags to apply when saving a proposal
            <Input
              value={tagDraft}
              onChange={event => setTagDraft(event.target.value)}
              placeholder="e.g. priority, renewal, follow-up"
              className="mt-2 border-white/15 bg-[#08172F] text-white"
            />
          </label>
          <div className="mt-5 space-y-3">
            {items.length ? (
              items.map(item => {
                const saved = savedItems.data?.find(
                  entry =>
                    entry.targetType === "action_proposal" &&
                    entry.targetKey === String(item.id)
                );
                return (
                  <article
                    key={item.id}
                    className="rounded-xl border border-white/10 bg-[#0B1B37] p-4"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <p className="font-bold text-white">{item.title}</p>
                        <p className="mt-1 text-sm text-[#A9BFDF]">
                          {item.targetLabel} ·{" "}
                          {item.actionType.replaceAll("_", " ")}
                        </p>
                        {saved?.tags.length ? (
                          <p className="mt-2 text-xs text-[#9FC2FF]">
                            Saved tags: {saved.tags.join(", ")}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          disabled={saveItem.isPending}
                          variant="outline"
                          onClick={() =>
                            saveItem.mutate({
                              targetType: "action_proposal",
                              targetKey: String(item.id),
                              title: `${item.targetLabel} — ${item.title}`,
                              tags,
                              isFavorite: true,
                            })
                          }
                          className="border-white/15 bg-white/5 text-white"
                        >
                          <Star className="mr-1 size-3.5" />
                          {saveItem.isPending
                            ? "Saving…"
                            : saved
                              ? "Update saved"
                              : "Save"}
                        </Button>
                        {item.state === "review_required" && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                review.mutate({
                                  proposalId: item.id,
                                  state: "skipped",
                                })
                              }
                              className="border-white/15 bg-white/5 text-white"
                            >
                              Skip
                            </Button>
                            <Button
                              size="sm"
                              onClick={() =>
                                review.mutate({
                                  proposalId: item.id,
                                  state: "approved",
                                })
                              }
                              className="bg-[#1B64F2]"
                            >
                              Approve
                            </Button>
                          </>
                        )}
                        {item.state === "approved" && (
                          <Button
                            size="sm"
                            disabled={execute.isPending}
                            onClick={() =>
                              execute.mutate({ proposalId: item.id })
                            }
                            className="bg-[#1B64F2]"
                          >
                            {execute.isPending ? "Running…" : "Run action"}
                          </Button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })
            ) : (
              <p className="text-sm text-[#A9BFDF]">
                No actions require review.
              </p>
            )}
          </div>
        </Panel>
        <Panel>
          <div className="flex items-center gap-2">
            <Star size={18} className="text-[#83AEFF]" />
            <p className="text-xs font-black uppercase tracking-[.14em] text-[#83AEFF]">
              Saved favorites
            </p>
          </div>
          <div className="mt-5 space-y-3">
            {savedItems.isLoading ? (
              <p className="text-sm text-[#A9BFDF]">Loading saved items…</p>
            ) : savedItems.isError ? (
              <div className="rounded-xl bg-rose-400/10 p-3 text-sm text-rose-100">
                Saved items could not load: {savedItems.error.message}
                <Button
                  size="sm"
                  onClick={() => savedItems.refetch()}
                  className="mt-3 bg-[#1B64F2]"
                >
                  Retry
                </Button>
              </div>
            ) : savedItems.data?.length ? (
              savedItems.data
                .filter(item => item.isFavorite)
                .map(item => (
                  <article
                    key={item.id}
                    className="rounded-xl border border-white/10 bg-[#0B1B37] p-3"
                  >
                    <div className="flex gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-white">{item.title}</p>
                        <p className="mt-1 text-xs text-[#9EB6DB]">
                          {item.tags.length ? item.tags.join(" · ") : "No tags"}
                        </p>
                      </div>
                      <button
                        disabled={removeItem.isPending}
                        onClick={() => removeItem.mutate({ id: item.id })}
                        className="text-[#9EB6DB] hover:text-white"
                        aria-label={`Remove ${item.title} from saved items`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </article>
                ))
            ) : (
              <p className="text-sm leading-6 text-[#A9BFDF]">
                Save a reviewable proposal to build a private, tagged
                quick-access list.
              </p>
            )}
          </div>
        </Panel>
      </div>
    </Frame>
  );
}

export function WorkflowStudio() {
  const [workflowKey, setWorkflowKey] = useState<WorkflowKey>("first_contact");
  const [leadLabel, setLeadLabel] = useState("");
  const [callOutcome, setCallOutcome] = useState<
    "no_answer" | "voicemail" | "answered"
  >("no_answer");
  const [notes, setNotes] = useState("");
  const prepare = trpc.assistant.prepareWorkflow.useMutation({
    onSuccess: () =>
      toast.success("Workflow preparation completed."),
    onError: error =>
      toast.error(`Workflow could not be prepared: ${error.message}`),
  });
  const needsOutcome = workflowKey === "post_consultation_follow_up";
  return (
    <Frame>
      <Header
        eyebrow="AMARKTAI NETWORK / WORKFLOW STUDIO"
        title="Prepare the next move—do not assume it."
        text="Provide factual context and create a reviewable plan. Preparation never sends a message or changes an external record."
      />
      <div className="mt-8 grid gap-6 lg:grid-cols-[.8fr_1.2fr]">
        <Panel>
          <p className="text-xs font-black uppercase tracking-[.14em] text-[#83AEFF]">
            Approved paths
          </p>
          <div className="mt-5 space-y-3">
            {workflows.map(flow => (
              <button
                key={flow.key}
                onClick={() => setWorkflowKey(flow.key)}
                className={`w-full rounded-xl border p-4 text-left ${workflowKey === flow.key ? "border-[#4E8BFF] bg-[#153B7A]" : "border-white/10 bg-[#0B1B37]"}`}
              >
                <p className="font-bold text-white">{flow.title}</p>
                <p className="mt-1 text-sm text-[#A9BFDF]">{flow.text}</p>
              </button>
            ))}
          </div>
        </Panel>
        <Panel>
          <div className="flex items-center gap-2 text-[#83AEFF]">
            <Workflow size={18} />
            <p className="text-xs font-black uppercase tracking-[.14em]">
              Factual input
            </p>
          </div>
          <Input
            value={leadLabel}
            onChange={event => setLeadLabel(event.target.value)}
            placeholder="Contact name"
            className="mt-5 border-white/15 bg-[#08172F] text-white"
          />
          {needsOutcome && (
            <>
              <select
                value={callOutcome}
                onChange={event =>
                  setCallOutcome(event.target.value as typeof callOutcome)
                }
                className="mt-4 h-11 w-full rounded-xl border border-white/15 bg-[#08172F] px-3 text-white"
              >
                <option value="no_answer">No answer</option>
                <option value="voicemail">Voicemail</option>
                <option value="answered">Answered</option>
              </select>
              <Textarea
                value={notes}
                onChange={event => setNotes(event.target.value)}
                placeholder="Only factual call notes…"
                className="mt-4 min-h-28 border-white/15 bg-[#08172F] text-white"
              />
            </>
          )}
          <Button
            disabled={prepare.isPending || !leadLabel.trim()}
            onClick={() =>
              prepare.mutate({
                workflowKey,
                leadLabel,
                ...(needsOutcome
                  ? { callOutcome, conversationNotes: notes || undefined }
                  : {}),
              })
            }
            className="mt-6 h-12 bg-[#1B64F2]"
          >
            {prepare.isPending ? "Preparing…" : "Prepare controlled workflow"}
            <ArrowRight className="ml-2 size-4" />
          </Button>
        </Panel>
      </div>
    </Frame>
  );
}

export function AgentDesk() {
  const [agentKey, setAgentKey] = useState("conversation_coach");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [contactId, setContactId] = useState<number | undefined>();
  const [assistantError, setAssistantError] = useState("");
  const [audio, setAudio] = useState<{ url: string; filename: string } | null>(
    null
  );
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState<
    Array<{ id: string; name: string; language: string | null }>
  >([]);
  const [voice, setVoice] = useState("");
  const agents = trpc.assistant.agents.useQuery();
  const customers = trpc.sales.customers.useQuery();
  useEffect(() => {
    fetch("/api/voice/voices", { credentials: "include" })
      .then(async response => {
        const body = (await response.json()) as {
          voices?: Array<{ id: string; name: string; language: string | null }>;
        };
        if (!response.ok) throw new Error("Voice profiles could not load.");
        const approved = body.voices ?? [];
        setVoices(approved);
        setVoice(current => current || approved[0]?.id || "");
      })
      .catch(() => setVoices([]));
  }, []);
  const chat = trpc.assistant.chat.useMutation({
    onSuccess: result => {
      setAnswer(result.content);
      setAssistantError("");
      setAudio(null);
    },
    onError: error => {
      setAssistantError(error.message);
      toast.error(`Assistant request failed: ${error.message}`);
    },
  });
  const ask = (prompt = question) => {
    const content = prompt.trim();
    if (!content) return;
    setQuestion(content);
    setAssistantError("");
    chat.mutate({ agentKey, contactId, messages: [{ role: "user", content }] });
  };
  const speak = async () => {
    if (!answer.trim()) return;
    setSpeaking(true);
    setAssistantError("");
    try {
      const response = await fetch("/api/voice/synthesize", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: answer, voice: voice || undefined }),
      });
      const result = (await response.json()) as {
        error?: string;
        audioBase64?: string;
        contentType?: string;
      };
      if (!response.ok || !result.audioBase64)
        throw new Error(
          result.error || "Speech generation returned no playable audio."
        );
      setAudio({
        url: `data:${result.contentType || "audio/wav"};base64,${result.audioBase64}`,
        filename: `amarktai-assistant-${new Date().toISOString().slice(0, 10)}.wav`,
      });
    } catch (error) {
      setAssistantError(
        error instanceof Error ? error.message : "Speech generation failed."
      );
    } finally {
      setSpeaking(false);
    }
  };
  const prompts = [
    "What do I know about this prospect?",
    "Prepare me for this call.",
    "What objection am I likely to hear?",
    "Write a follow-up.",
    "Summarise today's calls.",
    "Who should I contact next?",
  ];
  return (
    <Frame>
      <Header
        eyebrow="AMARKTAI / ASSISTANT"
        title="Work with the context already in your workspace."
        text="The assistant uses confirmed business knowledge, synchronized priorities, and the customer you select. External changes still require governed preparation and approval."
      />
      <div className="mt-8 grid gap-6 lg:grid-cols-[300px_1fr]">
        <Panel>
          <div className="flex items-center gap-2 text-[#83AEFF]">
            <ContactRound size={17} />
            <p className="text-xs font-black uppercase tracking-[.14em]">
              Working customer
            </p>
          </div>
          <select
            aria-label="Working customer"
            value={contactId ?? ""}
            onChange={event =>
              setContactId(
                event.target.value ? Number(event.target.value) : undefined
              )
            }
            className="mt-4 h-11 w-full rounded-xl border border-white/15 bg-[#08172F] px-3 text-sm text-white"
          >
            <option value="">No customer selected</option>
            {customers.data?.map(customer => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
                {customer.companyName ? ` · ${customer.companyName}` : ""}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs leading-5 text-[#8FA9CE]">
            Selecting a customer supplies normalized CRM context; it does not
            authorize a CRM write.
          </p>
          <div className="mt-6 border-t border-white/10 pt-5">
            {agents.isError ? (
              <div className="rounded-xl bg-rose-400/10 p-3 text-sm text-rose-100">
                Assistant roles could not load.
                <Button
                  size="sm"
                  onClick={() => agents.refetch()}
                  className="mt-3 bg-[#1B64F2]"
                >
                  Retry
                </Button>
              </div>
            ) : (
              agents.data?.agents.map(agent => (
                <button
                  key={agent.key}
                  onClick={() => setAgentKey(agent.key)}
                  className={`mb-2 w-full rounded-xl p-3 text-left ${agentKey === agent.key ? "bg-[#153B7A]" : "hover:bg-white/[.05]"}`}
                >
                  <p className="font-bold text-white">{agent.name}</p>
                  <p className="text-xs text-[#9EB6DB]">{agent.purpose}</p>
                </button>
              ))
            )}
          </div>
        </Panel>
        <Panel>
          {assistantError ? (
            <div
              role="alert"
              className="mb-4 rounded-xl border border-rose-300/20 bg-rose-400/10 p-4 text-sm text-rose-100"
            >
              <p className="flex items-center gap-2 font-bold">
                <AlertTriangle size={16} />
                The assistant request failed.
              </p>
              <p className="mt-2 leading-6">{assistantError}</p>
              <Button
                size="sm"
                disabled={!question.trim() || chat.isPending}
                onClick={() => ask()}
                className="mt-3 bg-[#1B64F2]"
              >
                Retry request
              </Button>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {prompts.map(prompt => (
              <button
                key={prompt}
                onClick={() => ask(prompt)}
                disabled={chat.isPending}
                className="rounded-full border border-white/10 bg-white/[.04] px-3 py-2 text-xs font-bold text-[#BBD2F4] hover:border-[#4E8BFF]"
              >
                {prompt}
              </button>
            ))}
          </div>
          <Textarea
            aria-label="Question for the Sales Assistant"
            value={question}
            onChange={event => setQuestion(event.target.value)}
            placeholder="Ask about this customer, your next call, a follow-up, or today's priorities…"
            className="mt-5 min-h-32 border-white/15 bg-[#08172F] text-white"
          />
          <Button
            disabled={!question.trim() || chat.isPending}
            onClick={() => ask()}
            className="mt-4 bg-[#1B64F2]"
          >
            {chat.isPending ? "Working…" : "Ask assistant"}
          </Button>
          {answer ? (
            <div className="mt-5 rounded-xl bg-[#0B1B37] p-4">
              <p className="whitespace-pre-wrap text-sm leading-7 text-[#D6E5FF]">
                {answer}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {voices.length > 1 ? (
                  <select
                    aria-label="Approved voice"
                    value={voice}
                    onChange={event => setVoice(event.target.value)}
                    className="h-9 rounded-md border border-white/15 bg-[#08172F] px-2 text-xs text-white"
                  >
                    {voices.map(item => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                        {item.language ? ` · ${item.language}` : ""}
                      </option>
                    ))}
                  </select>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={speaking}
                  onClick={() => void speak()}
                  className="border-white/15 bg-white/5 text-white"
                >
                  <Volume2 className="mr-2 size-4" />
                  {speaking ? "Creating audio…" : "Read aloud"}
                </Button>
                {audio ? (
                  <>
                    <audio
                      controls
                      src={audio.url}
                      className="h-9 max-w-full"
                    />
                    <a
                      download={audio.filename}
                      href={audio.url}
                      className="inline-flex h-9 items-center rounded-md border border-white/15 px-3 text-xs font-bold text-white"
                    >
                      <Download className="mr-2 size-4" />
                      Download
                    </a>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}
        </Panel>
      </div>
    </Frame>
  );
}

export function CallDesk() {
  const [leadLabel, setLeadLabel] = useState("");
  const [transcript, setTranscript] = useState("");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [tip, setTip] = useState("");
  const start = trpc.calls.startLive.useMutation({
    onSuccess: result => {
      setSessionId(result.callSessionId);
      toast.success("Call session started.");
    },
    onError: error => toast.error(`Could not start call: ${error.message}`),
  });
  const coach = trpc.calls.coachTranscript.useMutation({
    onSuccess: result => setTip(result.content),
    onError: error => toast.error(`Coaching request failed: ${error.message}`),
  });
  const finish = trpc.calls.completeLive.useMutation({
    onSuccess: result => {
      setTip(result.content);
      toast.success("Summary saved for review.");
    },
    onError: error =>
      toast.error(`Could not complete summary: ${error.message}`),
  });
  return (
    <Frame>
      <Header
        eyebrow="AMARKTAI NETWORK / CALL DESK"
        title="Capture what was said. Prepare what comes next."
        text="Create coaching and factual summaries from the text you provide; no message is sent by this call desk."
      />
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Panel>
          <div className="flex items-center gap-2 text-[#83AEFF]">
            <Headphones size={18} />
            <p className="text-xs font-black uppercase tracking-[.14em]">
              Live session
            </p>
          </div>
          <Input
            value={leadLabel}
            onChange={event => setLeadLabel(event.target.value)}
            placeholder="Contact name"
            className="mt-5 border-white/15 bg-[#08172F] text-white"
          />
          <Textarea
            value={transcript}
            onChange={event => setTranscript(event.target.value)}
            placeholder="Enter only factual call text…"
            className="mt-4 min-h-48 border-white/15 bg-[#08172F] text-white"
          />
          {!sessionId ? (
            <Button
              disabled={!leadLabel.trim() || start.isPending}
              onClick={() => start.mutate({ leadLabel })}
              className="mt-4 bg-[#1B64F2]"
            >
              {start.isPending ? "Starting…" : "Start call session"}
            </Button>
          ) : (
            <div className="mt-4 flex gap-2">
              <Button
                disabled={!transcript.trim() || coach.isPending}
                onClick={() =>
                  coach.mutate({
                    callSessionId: sessionId,
                    leadLabel,
                    transcriptChunk: transcript,
                  })
                }
                className="bg-[#1B64F2]"
              >
                {coach.isPending ? "Coaching…" : "Request coaching"}
              </Button>
              <Button
                variant="outline"
                disabled={!transcript.trim() || finish.isPending}
                onClick={() =>
                  finish.mutate({
                    callSessionId: sessionId,
                    leadLabel,
                    transcript,
                  })
                }
                className="border-white/15 text-white"
              >
                {finish.isPending ? "Saving…" : "Complete summary"}
              </Button>
            </div>
          )}
        </Panel>
        <Panel>
          <div className="flex items-center gap-2 text-[#83AEFF]">
            <MessageSquareText size={18} />
            <p className="text-xs font-black uppercase tracking-[.14em]">
              Reviewable support
            </p>
          </div>
          <p className="mt-5 whitespace-pre-wrap text-sm leading-6 text-[#D6E5FF]">
            {tip || "No guidance has been requested yet."}
          </p>
        </Panel>
      </div>
    </Frame>
  );
}

export function KnowledgeHub() {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const sources = trpc.knowledge.list.useQuery();
  const add = trpc.knowledge.add.useMutation({
    onSuccess: () => {
      setTitle("");
      setContent("");
      sources.refetch();
      toast.success("Approved knowledge source added.");
    },
    onError: error => toast.error(`Could not save knowledge: ${error.message}`),
  });
  return (
    <Frame>
      <Header
        eyebrow="AMARKTAI NETWORK / KNOWLEDGE"
        title="Give the team approved context."
        text="Add approved policy, product, and sales notes that can ground knowledge guidance."
      />
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Panel>
          <div className="flex items-center gap-2 text-[#83AEFF]">
            <LibraryBig size={18} />
            <p className="text-xs font-black uppercase tracking-[.14em]">
              New approved note
            </p>
          </div>
          <Input
            aria-label="Approved knowledge title"
            value={title}
            onChange={event => setTitle(event.target.value)}
            placeholder="Product or service FAQ"
            className="mt-5 border-white/15 bg-[#08172F] text-white"
          />
          <Textarea
            aria-label="Approved knowledge content"
            value={content}
            onChange={event => setContent(event.target.value)}
            placeholder="Paste approved policy, product, or sales content…"
            className="mt-4 min-h-48 border-white/15 bg-[#08172F] text-white"
          />
          <Button
            disabled={!title.trim() || !content.trim() || add.isPending}
            onClick={() => add.mutate({ title, content, sourceType: "note" })}
            className="mt-4 bg-[#1B64F2]"
          >
            {add.isPending ? "Saving…" : "Add approved source"}
          </Button>
        </Panel>
        <Panel>
          <div className="flex items-center gap-2 text-[#83AEFF]">
            <CheckCircle2 size={18} />
            <p className="text-xs font-black uppercase tracking-[.14em]">
              Available context
            </p>
          </div>
          <div className="mt-5 space-y-3">
            {sources.isError ? (
              <div className="rounded-xl bg-rose-400/10 p-4 text-sm text-rose-100">
                Knowledge could not load: {sources.error.message}
                <Button
                  size="sm"
                  onClick={() => sources.refetch()}
                  className="mt-3 bg-[#1B64F2]"
                >
                  Retry knowledge
                </Button>
              </div>
            ) : sources.data?.length ? (
              sources.data.map(source => (
                <article
                  key={source.id}
                  className="rounded-xl border border-white/10 bg-[#0B1B37] p-4"
                >
                  <p className="font-bold text-white">{source.title}</p>
                  <p className="mt-1 text-xs text-[#9DB3D5]">
                    {source.sourceType} · {source.status}
                    {source.sourceMetadata &&
                    typeof source.sourceMetadata.category === "string"
                      ? ` · ${source.sourceMetadata.category}`
                      : ""}
                  </p>
                  {source.sourceUrl ? (
                    <a
                      href={source.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 block truncate text-xs font-bold text-[#83AEFF]"
                    >
                      Source: {source.sourceUrl}
                    </a>
                  ) : null}
                  <p className="mt-2 text-[11px] text-[#7896C1]">
                    {source.sourceFetchedAt
                      ? `Read ${new Date(source.sourceFetchedAt).toLocaleString()}`
                      : `Approved ${new Date(source.createdAt).toLocaleString()}`}
                  </p>
                </article>
              ))
            ) : (
              <p className="text-sm text-[#A9BFDF]">No approved sources yet.</p>
            )}
          </div>
        </Panel>
      </div>
    </Frame>
  );
}
