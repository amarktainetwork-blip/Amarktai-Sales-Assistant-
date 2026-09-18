import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/_core/hooks/useAuth";
import { friendlyError } from "@/lib/friendlyError";
import { trpc } from "@/lib/trpc";
import {
  ArrowRight,
  BookOpen,
  BriefcaseBusiness,
  CalendarClock,
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
  "Who should I call next?",
  "Prepare my next call",
  "Summarise this customer",
  "Draft a follow-up — don't send",
];

const emptyState =
  "Use me for the work around the call: prioritising, call preparation, customer summaries, follow-up drafts and reminders. Customer-facing actions stay reviewable.";

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

function AssistantMark({ compact = false }: { compact?: boolean }) {
  const size = compact
    ? "h-8 w-8 rounded-lg text-[10px]"
    : "h-10 w-10 rounded-xl text-[12px]";
  return (
    <span
      aria-label="AmarktAI"
      className={`${size} grid shrink-0 place-items-center bg-gradient-to-br from-[#2F6FED] to-[#4FB9FF] font-black tracking-[-.04em] text-white shadow-[0_8px_20px_rgba(47,111,237,.20)]`}
    >
      AI
    </span>
  );
}

export default function Assistant() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const organisation = trpc.organisation.current.useQuery();
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

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";

  return (
    <DashboardLayout>
      <div
        data-assistant-workspace
        className="mx-auto flex h-[calc(100dvh-120px)] min-h-[520px] max-w-[1180px] flex-col overflow-hidden text-[#24344A]"
      >
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[#D7E0EA] pb-4">
          <div className="flex min-w-0 items-center gap-3">
            <AssistantMark />
            <div className="min-w-0">
              <p className="text-sm font-black tracking-[-.01em] text-[#24344A]">
                Amarkt<span className="text-[#2F6FED]">AI</span>
              </p>
              <h1 className="truncate text-sm font-medium text-[#6B7B90]">
                Good {greeting}, {firstName}. Give me the admin around the call.
              </h1>
            </div>
          </div>

          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <label className="flex min-w-0 items-center gap-2 text-xs font-semibold text-[#66758A]">
              <Search className="h-4 w-4 shrink-0 text-[#2F6FED]" />
              <span className="sr-only">Find customer context</span>
              <Input
                aria-label="Find customer context"
                value={contextSearch}
                onChange={event => setContextSearch(event.target.value)}
                placeholder="Find customer…"
                className="h-9 w-[170px] bg-white text-xs sm:w-[220px]"
              />
            </label>
            <label className="flex min-w-0 items-center gap-2 text-xs font-semibold text-[#66758A]">
              <UserRound className="h-4 w-4 shrink-0 text-[#2F6FED]" />
              <span className="sr-only">Customer context</span>
              <select
                aria-label="Customer context"
                value={contactId ?? ""}
                onChange={event =>
                  setContactId(
                    event.target.value ? Number(event.target.value) : undefined
                  )
                }
                className="h-9 max-w-[min(52vw,320px)] truncate rounded-xl border border-[#CAD6E4] bg-white px-3 text-xs font-semibold text-[#33445B] outline-none focus:border-[#2F6FED] focus:ring-2 focus:ring-[#DCE7F6]"
              >
                <option value="">All customers</option>
                {contextOptions.map(customer => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                    {customer.companyName ? ` · ${customer.companyName}` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>

        {selectedCustomer ? (
          <div className="shrink-0 border-b border-[#E5EAF0] py-3">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#DCE4EE] bg-[#F8FAFD] px-4 py-3">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[.12em] text-[#2F6FED]">
                  Working on
                </p>
                <p className="mt-1 truncate font-bold text-[#33445B]">
                  {selectedCustomer.name}
                </p>
                {selectedCustomer.interest.primary ? (
                  <p className="mt-1 text-xs font-bold text-[#315EA8]">
                    Course interest: {selectedCustomer.interest.primary}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-[#718096]">
                  {selectedCustomer.nextAction?.title ||
                    selectedCustomer.openOpportunity?.stage ||
                    "Customer context loaded"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    navigate(`/customers?contactId=${selectedCustomer.id}`)
                  }
                >
                  <UserRound className="mr-2 h-3.5 w-3.5" />
                  Full context
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    navigate(`/calls?contactId=${selectedCustomer.id}`)
                  }
                >
                  <Headphones className="mr-2 h-3.5 w-3.5" />
                  Open call
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col pt-3">
          <section
            data-assistant-conversation
            className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#D7E0EA] bg-white"
          >
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-7 sm:py-6">
              <div
                className={`mx-auto flex min-h-full max-w-3xl flex-col ${!messages.length ? "justify-center py-8" : ""}`}
              >
                {!messages.length ? (
                  <div className="flex max-w-2xl items-start gap-3">
                    <AssistantMark compact />
                    <div className="min-w-0 flex-1">
                      <div className="rounded-2xl rounded-tl-md bg-[#F4F7FB] px-4 py-3 text-[15px] leading-7 text-[#33445B]">
                        {emptyState}
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {suggestions.map(prompt => (
                          <button
                            key={prompt}
                            type="button"
                            onClick={() => void send(prompt)}
                            className="rounded-full border border-[#D7E1EE] bg-white px-3.5 py-2 text-xs font-semibold text-[#40516A] transition hover:border-[#9CB8E8] hover:bg-[#F1F6FF] hover:text-[#2F63C7]"
                          >
                            {prompt}
                          </button>
                        ))}
                      </div>
                      {selectedCustomer ? (
                        <div className="mt-5 grid gap-2 sm:grid-cols-2">
                          <ContextFact
                            icon={BookOpen}
                            label="Course interest"
                            value={
                              selectedCustomer.interest.primary ||
                              "Not yet identified"
                            }
                          />
                          <ContextFact
                            icon={CalendarClock}
                            label="Next task"
                            value={
                              selectedCustomer.nextAction?.title ||
                              "No current task"
                            }
                          />
                          <ContextFact
                            icon={BriefcaseBusiness}
                            label="Opportunity"
                            value={
                              selectedCustomer.openOpportunity?.name ||
                              "No open opportunity"
                            }
                          />
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {selectedCustomer ? (
                      <p className="flex items-center gap-2 text-xs font-semibold text-[#718096]">
                        <UserRound className="h-3.5 w-3.5" />
                        Customer context: {selectedCustomer.name}
                      </p>
                    ) : null}

                    {messages.map((message, index) => (
                      <div
                        key={`${message.role}-${index}`}
                        className={
                          message.role === "user"
                            ? "ml-auto max-w-[min(82%,680px)] rounded-2xl rounded-br-md bg-[#2F6FED] px-4 py-3 text-[15px] leading-6 text-white"
                            : "max-w-[min(94%,760px)]"
                        }
                      >
                        {message.role === "assistant" ? (
                          <div className="flex gap-3">
                            <AssistantMark compact />
                            <div className="min-w-0 flex-1">
                              <div className="whitespace-pre-wrap text-[15px] leading-7 text-[#33445B]">
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
                      <div className="flex items-center gap-3 text-sm text-[#718096]">
                        <AssistantMark compact />
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Working with the current sales context…
                      </div>
                    ) : null}

                    {error ? (
                      <div
                        role="alert"
                        className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
                      >
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

            <div
              data-assistant-composer
              className="shrink-0 border-t border-[#E5EAF0] bg-[#FAFCFF] p-3 sm:p-4"
            >
              <div className="mx-auto max-w-3xl rounded-2xl border border-[#CBD7E6] bg-white p-2 focus-within:border-[#8AACE6] focus-within:ring-2 focus-within:ring-[#E5EDFB]">
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
                      ? `Ask AmarktAI about ${selectedCustomer.name}…`
                      : "Ask AmarktAI to prioritise, prepare, summarise or draft…"
                  }
                  className="min-h-[62px] resize-none border-0 bg-transparent px-3 py-3 text-[15px] leading-6 shadow-none focus-visible:ring-0"
                />
                <div className="flex items-center justify-between gap-3 border-t border-[#EEF2F6] px-2 pt-2">
                  <p className="text-[11px] text-[#8290A3]">
                    Draft first. Customer-facing actions remain governed and
                    reviewable.
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

function ContextFact({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CalendarClock;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-[#DCE4EE] bg-[#FAFCFF] p-3">
      <div className="flex items-center gap-2 text-[#2F6FED]">
        <Icon className="h-3.5 w-3.5" />
        <p className="text-[10px] font-black uppercase tracking-[.1em] text-[#7B8CA2]">
          {label}
        </p>
      </div>
      <p className="mt-1.5 text-sm font-bold leading-5 text-[#33445B]">
        {value}
      </p>
    </div>
  );
}
