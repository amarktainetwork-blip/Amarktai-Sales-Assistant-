import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { friendlyError } from "@/lib/friendlyError";
import { trpc } from "@/lib/trpc";
import {
  ArrowRight,
  Headphones,
  Loader2,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";

type Message = {
  role: "user" | "assistant";
  content: string;
  action?: { label: string; path: string };
};

type AssistantResponse = {
  content?: string;
  error?: string;
  suggestedAction?: { label: string; path: string };
  reviewRequired?: boolean;
};

const suggestions = [
  "Prepare me for this call",
  "Summarise the customer history",
  "What matters most about this customer?",
  "What should I ask next?",
  "What objections should I prepare for?",
  "Draft the right follow-up — don't send",
  "Show me the approved templates available here",
];

async function askAssistant(input: {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  contactId?: number;
}) {
  const response = await fetch("/api/assistant", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await response.json().catch(() => ({}))) as AssistantResponse;
  if (!response.ok)
    throw new Error(body.error || "AmarktAI could not respond.");
  if (!body.content?.trim())
    throw new Error("AmarktAI returned an empty intelligence response.");
  return body;
}

function displayContextValue(value: unknown) {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  if (value == null) return "";
  return String(value).trim();
}

function AssistantMark() {
  return (
    <span
      aria-hidden="true"
      className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#EAF0F2] text-[#55788B]"
    >
      <Sparkles className="h-5 w-5" />
    </span>
  );
}

export default function Assistant() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const organisation = trpc.organisation.current.useQuery();
  const organisationId = organisation.data?.organisationId;
  const today = trpc.sales.today.useQuery(
    { organisationId: organisationId ?? 0 },
    { enabled: Boolean(organisationId), retry: false, refetchInterval: 30_000 }
  );

  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [contactId, setContactId] = useState<number | undefined>();
  const [contextSearch, setContextSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chatEnd = useRef<HTMLDivElement>(null);

  const customers = trpc.sales.customerDirectory.useQuery(
    { page: 1, pageSize: 25, search: contextSearch, sort: "updated" },
    { retry: false }
  );
  const customerDetail = trpc.sales.customerDetail.useQuery(
    { contactId: contactId || 1 },
    { enabled: Boolean(contactId), retry: false }
  );
  const selectedCustomer = customerDetail.data ?? undefined;
  const dayItem = today.data?.queues.callQueue?.find(
    item => item.contactId === contactId
  );

  const startCall = trpc.calls.startLive.useMutation({
    onSuccess: (result, variables) =>
      navigate(
        `/calls?sessionId=${result.callSessionId}${
          variables.contactId ? `&contactId=${variables.contactId}` : ""
        }`
      ),
  });

  const contextOptions = useMemo(() => {
    const items = customers.data?.items ?? [];
    if (!selectedCustomer) return items;
    return [
      selectedCustomer,
      ...items.filter(customer => customer.id !== selectedCustomer.id),
    ];
  }, [customers.data?.items, selectedCustomer]);

  const firstName =
    organisation.data?.memberOnboarding.preferredName ||
    user?.name?.trim().split(/\s+/)[0] ||
    "there";

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const prompt = params.get("prompt")?.trim();
    const selected = Number(params.get("contactId"));
    if (prompt) setDraft(prompt.slice(0, 12_000));
    if (Number.isInteger(selected) && selected > 0) setContactId(selected);
  }, []);

  useEffect(() => {
    if (contactId) return;
    const next = today.data?.queues.callQueue?.[0];
    if (next?.contactId) setContactId(next.contactId);
  }, [contactId, today.data?.queues.callQueue]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  function responseMessage(response: AssistantResponse): Message {
    return {
      role: "assistant",
      content: response.content!,
      action:
        response.suggestedAction ||
        (response.reviewRequired
          ? { label: "Open Review", path: "/reviews" }
          : undefined),
    };
  }

  async function send(prompt = draft) {
    const content = prompt.trim();
    if (!content || busy) return;
    const nextMessages: Message[] = [...messages, { role: "user", content }];
    setMessages(nextMessages);
    setDraft("");
    setError("");
    setBusy(true);
    try {
      const response = await askAssistant({
        contactId,
        messages: nextMessages.map(message => ({
          role: message.role,
          content: message.content,
        })),
      });
      setMessages(current => [...current, responseMessage(response)]);
    } catch (cause) {
      setError(
        friendlyError(
          cause,
          "I couldn't complete that request just now. Nothing was changed."
        )
      );
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    if (busy || !messages.length) return;
    setError("");
    setBusy(true);
    try {
      const response = await askAssistant({
        contactId,
        messages: messages.map(message => ({
          role: message.role,
          content: message.content,
        })),
      });
      setMessages(current => [...current, responseMessage(response)]);
    } catch (cause) {
      setError(
        friendlyError(
          cause,
          "I couldn't complete that request just now. Nothing was changed."
        )
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <DashboardLayout>
      <div
        id="assistant-page"
        data-assistant-workspace
        aria-label="AmarktAI"
        className="mx-auto flex max-w-[1180px] flex-col gap-5 text-[#20283A]"
      >
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-base font-medium text-[#7A8497]">AmarktAI</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-[-.035em]">
              {selectedCustomer
                ? `Work ${selectedCustomer.name} with me.`
                : `Your sales assistant is ready, ${firstName}.`}
            </h1>
            <p className="mt-1 max-w-2xl text-base leading-6 text-[#667085]">
              You handle the conversation. AmarktAI handles the preparation,
              context and draft admin around it.
            </p>
          </div>
          {organisation.data?.role === "owner" ||
          organisation.data?.role === "manager" ||
          user?.role === "admin" ? (
            <Button
              variant="outline"
              onClick={() => navigate("/settings?section=skills#skills")}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Teach AmarktAI
            </Button>
          ) : null}
        </header>

        <div className="grid min-h-[calc(100dvh-190px)] gap-5 lg:grid-cols-[330px_1fr]">
          <aside
            data-assistant-context
            className="flex flex-col rounded-2xl bg-white p-5 shadow-[0_6px_24px_rgba(38,50,71,.05)]"
          >
            <div className="flex items-center gap-3">
              <AssistantMark />
              <div className="min-w-0">
                <p className="text-sm font-medium text-[#7A8497]">
                  Current customer
                </p>
                <p className="truncate text-base font-semibold text-[#293145]">
                  {selectedCustomer?.name || "Choose a customer"}
                </p>
              </div>
            </div>

            {selectedCustomer ? (
              <>
                <div data-assistant-facts className="mt-5 space-y-4">
                  <Fact
                    label="Why now"
                    value={
                      dayItem?.headline ||
                      selectedCustomer.nextAction?.title ||
                      "Customer context is ready"
                    }
                  />
                  <Fact
                    label="Interest"
                    value={
                      selectedCustomer.interest.primary || "Not yet identified"
                    }
                  />
                  <Fact
                    label="Next task"
                    value={
                      selectedCustomer.nextAction?.title || "No current task"
                    }
                  />
                  <Fact
                    label="Opportunity"
                    value={
                      selectedCustomer.openOpportunity?.name ||
                      selectedCustomer.openOpportunity?.stage ||
                      "No open opportunity"
                    }
                  />
                  <Fact
                    label="Last interaction"
                    value={
                      selectedCustomer.lastInteraction
                        ? selectedCustomer.lastInteraction.activityType +
                          " · " +
                          new Date(
                            selectedCustomer.lastInteraction.occurredAt
                          ).toLocaleString()
                        : "No recent interaction"
                    }
                  />
                  {selectedCustomer.mappedFields
                    .filter(field => displayContextValue(field.value))
                    .slice(0, 4)
                    .map(field => (
                      <Fact
                        key={field.sourceFieldId}
                        label={field.label}
                        value={displayContextValue(field.value)}
                      />
                    ))}
                </div>

                {dayItem?.reasons?.length ? (
                  <div
                    data-assistant-reasons
                    className="mt-5 border-t border-[#E8EAF1] pt-4"
                  >
                    <p className="text-sm font-medium text-[#7A8497]">
                      Why this is in Today
                    </p>
                    <div className="mt-2 space-y-1 text-sm leading-5 text-[#606B80]">
                      {dayItem.reasons.slice(0, 4).map(reason => (
                        <p key={reason}>• {reason}</p>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div data-assistant-actions className="mt-5 grid gap-2">
                  <Button
                    disabled={startCall.isPending}
                    onClick={() =>
                      startCall.mutate({
                        leadLabel: selectedCustomer.name,
                        contactId: selectedCustomer.id,
                      })
                    }
                  >
                    <Headphones className="mr-2 h-4 w-4" />
                    {startCall.isPending ? "Opening…" : "Start call"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      navigate(`/customers?contactId=${selectedCustomer.id}`)
                    }
                  >
                    <UserRound className="mr-2 h-4 w-4" />
                    Full customer context
                  </Button>
                </div>
              </>
            ) : (
              <p className="mt-5 text-base leading-6 text-[#667085]">
                When Today has work, the next customer is selected
                automatically.
              </p>
            )}

            <div
              data-assistant-picker
              className="mt-auto border-t border-[#E8EAF1] pt-4"
            >
              <label className="text-sm font-medium text-[#7A8497]">
                Change customer
              </label>
              <div className="mt-2 flex items-center gap-2">
                <Search className="h-4 w-4 shrink-0 text-[#8A93A5]" />
                <Input
                  value={contextSearch}
                  onChange={event => setContextSearch(event.target.value)}
                  placeholder="Search…"
                  className="h-10 border-[#E2E5EE] text-base"
                />
              </div>
              <select
                aria-label="Customer context"
                value={contactId ?? ""}
                onChange={event =>
                  setContactId(
                    event.target.value ? Number(event.target.value) : undefined
                  )
                }
                className="mt-2 h-11 w-full rounded-xl border border-[#E2E5EE] bg-white px-3 text-base text-[#293145] outline-none focus:border-[#7D9AAA]"
              >
                <option value="">Select customer</option>
                {contextOptions.map(customer => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                    {customer.companyName ? ` · ${customer.companyName}` : ""}
                  </option>
                ))}
              </select>
            </div>
          </aside>

          <section
            data-assistant-conversation
            className="flex min-h-0 flex-col overflow-hidden rounded-2xl bg-white shadow-[0_6px_24px_rgba(38,50,71,.05)]"
          >
            <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7">
              <div className="mx-auto max-w-3xl">
                {!messages.length ? (
                  <div>
                    <div className="flex items-start gap-3">
                      <AssistantMark />
                      <div
                        data-assistant-welcome
                        className="rounded-2xl bg-[#F7F8FC] px-4 py-3 text-base leading-7 text-[#293145]"
                      >
                        {selectedCustomer
                          ? `I have ${selectedCustomer.name}'s sales context. I can prepare the call, surface the important history, help with objections and draft the follow-up for Review.`
                          : "I can prioritise your day, prepare calls, summarise customers and draft follow-ups for Review."}
                      </div>
                    </div>

                    <div className="mt-5 grid gap-2 sm:grid-cols-2">
                      {suggestions.map(prompt => (
                        <button
                          key={prompt}
                          type="button"
                          onClick={() => void send(prompt)}
                          data-assistant-prompt
                          className="rounded-xl bg-[#FBFCF8] px-4 py-3 text-left text-base font-medium text-[#4E586C] hover:bg-[#F4F6F1]"
                        >
                          <Sparkles className="mb-2 h-4 w-4 text-[#55788B]" />
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {messages.map((message, index) => (
                      <div
                        key={`${message.role}-${index}`}
                        className={
                          message.role === "user"
                            ? "ml-auto max-w-[80%] rounded-2xl bg-[#55788B] px-4 py-3 text-base leading-6 text-white"
                            : "max-w-[92%]"
                        }
                      >
                        {message.role === "assistant" ? (
                          <div className="flex gap-3">
                            <AssistantMark />
                            <div className="min-w-0 flex-1">
                              <div className="whitespace-pre-wrap text-base leading-7 text-[#293145]">
                                {message.content}
                              </div>
                              {message.action ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="mt-3"
                                  onClick={() => navigate(message.action!.path)}
                                >
                                  {message.action.label}
                                  <ArrowRight className="ml-2 h-3.5 w-3.5" />
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        ) : (
                          message.content
                        )}
                      </div>
                    ))}

                    {busy ? (
                      <div className="flex items-center gap-3 text-base text-[#667085]">
                        <AssistantMark />
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Working with the current sales context…
                      </div>
                    ) : null}

                    {error ? (
                      <div className="rounded-xl bg-[#FFF1F1] px-4 py-3 text-base text-[#8A3B3B]">
                        <p>{error}</p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-3"
                          onClick={() => void retry()}
                          disabled={busy}
                        >
                          <RotateCcw className="mr-2 h-3.5 w-3.5" />
                          Try again
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )}
                <div ref={chatEnd} />
              </div>
            </div>

            <div className="border-t border-[#E8EAF1] bg-[#FAFBFC] p-3 sm:p-4">
              <div className="mx-auto max-w-3xl">
                <Textarea
                  aria-label="Message AmarktAI"
                  value={draft}
                  onChange={event => setDraft(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  placeholder={
                    selectedCustomer
                      ? `Ask about ${selectedCustomer.name}…`
                      : "Ask AmarktAI about your day…"
                  }
                  className="min-h-[72px] resize-none rounded-xl border-[#E0E4E9] bg-white px-4 py-3 text-base leading-6 shadow-none focus-visible:ring-[#B9C2CE]"
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="text-sm text-[#8A93A5]">
                    Draft first. Customer-facing actions remain reviewable.
                  </p>
                  <Button
                    size="sm"
                    disabled={!draft.trim() || busy}
                    onClick={() => void send()}
                  >
                    {busy ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="mr-2 h-4 w-4" />
                    )}
                    Send
                  </Button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </DashboardLayout>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div data-assistant-fact>
      <p className="text-sm font-medium text-[#8A93A5]">{label}</p>
      <p className="mt-1 text-base font-medium leading-6 text-[#3F485C]">
        {value}
      </p>
    </div>
  );
}
