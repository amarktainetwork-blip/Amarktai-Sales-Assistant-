import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { friendlyError } from "@/lib/friendlyError";
import {
  ArrowRight,
  Bot,
  CalendarClock,
  CheckCircle2,
  Headphones,
  Loader2,
  MessageCircle,
  RotateCcw,
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

const quickPrompts = [
  "What are my overdue tasks?",
  "Who should I contact next?",
  "Prepare me for my next call.",
  "Help me handle likely objections.",
  "Which customers are waiting for a reply?",
  "What promises have we made?",
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
    throw new Error(body.error || "The Assistant could not respond.");
  return body;
}

export default function Assistant() {
  const [, navigate] = useLocation();
  const customers = trpc.sales.customers.useQuery();
  const organisation = trpc.organisation.current.useQuery();
  const today = trpc.sales.today.useQuery(
    { organisationId: organisation.data?.organisationId || 0 },
    { enabled: Boolean(organisation.data?.organisationId) }
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [contactId, setContactId] = useState<number | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chatEnd = useRef<HTMLDivElement>(null);

  const selectedCustomer = useMemo(
    () => customers.data?.find(customer => customer.id === contactId),
    [contactId, customers.data]
  );

  useEffect(() => {
    const prompt = new URLSearchParams(window.location.search)
      .get("prompt")
      ?.trim();
    if (prompt) setDraft(prompt.slice(0, 12_000));
  }, []);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

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
      setMessages(current => [
        ...current,
        {
          role: "assistant",
          content:
            response.content || "I’m ready. What would you like to do next?",
          action: response.suggestedAction,
        },
      ]);
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
      setMessages(current => [
        ...current,
        {
          role: "assistant",
          content:
            response.content || "I’m ready. What would you like to do next?",
          action: response.suggestedAction,
        },
      ]);
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

  const hasConversation = messages.length > 0;
  const metrics = today.data?.metrics;

  return (
    <DashboardLayout>
      <div className="mx-auto flex min-h-[calc(100vh-130px)] max-w-6xl flex-col text-[#26354A]">
        <header className="rounded-3xl border border-[#DCE4EE] bg-white px-5 py-6 shadow-sm sm:px-8 sm:py-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[#3F70D8]">
                <Sparkles className="h-4 w-4" />
                <p className="text-[11px] font-black uppercase tracking-[.16em]">
                  Amarktai Assistant
                </p>
              </div>
              <h1 className="mt-3 max-w-3xl font-display text-4xl font-bold tracking-[-.06em] text-[#26354A] sm:text-5xl">
                What can I help you get done?
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#66758A] sm:text-base">
                Ask in normal language. I’ll use your CRM, company knowledge,
                sales context and the right specialist automatically.
              </p>
            </div>

            <label className="block min-w-[250px] text-xs font-bold text-[#526277]">
              Working with a customer
              <select
                value={contactId ?? ""}
                onChange={event =>
                  setContactId(
                    event.target.value ? Number(event.target.value) : undefined
                  )
                }
                className="mt-2 h-11 w-full rounded-xl border border-[#CCD6E2] bg-white px-3 text-sm text-[#26354A] outline-none focus:border-[#3F70D8] focus:ring-2 focus:ring-[#DCE7F6]"
              >
                <option value="">No customer selected</option>
                {customers.data?.map(customer => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                    {customer.companyName ? ` · ${customer.companyName}` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>

        {!hasConversation ? (
          <div className="grid flex-1 gap-5 py-6 lg:grid-cols-[1fr_330px]">
            <section className="rounded-3xl border border-[#DCE4EE] bg-white p-5 shadow-sm sm:p-7">
              <div className="flex items-center gap-2">
                <MessageCircle className="h-5 w-5 text-[#3F70D8]" />
                <h2 className="font-display text-2xl font-bold tracking-[-.04em]">
                  Try asking me
                </h2>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {quickPrompts.map(prompt => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void send(prompt)}
                    className="group rounded-2xl border border-[#DDE5EF] bg-[#FAFCFF] p-4 text-left text-sm font-semibold leading-6 text-[#33445B] transition hover:border-[#9CB8E8] hover:bg-[#F3F7FF]"
                  >
                    {prompt}
                    <ArrowRight className="mt-3 h-4 w-4 text-[#8290A3] transition group-hover:translate-x-1 group-hover:text-[#3F70D8]" />
                  </button>
                ))}
              </div>
            </section>

            <aside className="rounded-3xl border border-[#DCE4EE] bg-white p-5 shadow-sm sm:p-6">
              <p className="text-[10px] font-black uppercase tracking-[.15em] text-[#8290A3]">
                Right now
              </p>
              <div className="mt-4 space-y-3">
                <Snapshot
                  icon={CalendarClock}
                  value={metrics?.overdue ?? 0}
                  label="overdue tasks"
                  onClick={() => void send("What are my overdue tasks?")}
                />
                <Snapshot
                  icon={CheckCircle2}
                  value={metrics?.dueToday ?? 0}
                  label="due today"
                  onClick={() => void send("What do I have due today?")}
                />
                <Snapshot
                  icon={UserRound}
                  value={metrics?.priorityRecords ?? 0}
                  label="customers needing attention"
                  onClick={() => void send("Who should I contact next?")}
                />
              </div>
              <Button
                variant="outline"
                className="mt-5 w-full justify-start"
                onClick={() => navigate("/calls")}
              >
                <Headphones className="mr-2 h-4 w-4" />
                Open call companion
              </Button>
            </aside>
          </div>
        ) : (
          <section className="my-6 flex min-h-[430px] flex-1 flex-col overflow-hidden rounded-3xl border border-[#DCE4EE] bg-white shadow-sm">
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-7 sm:py-7">
              <div className="mx-auto max-w-3xl space-y-5">
                {selectedCustomer ? (
                  <div className="flex items-center gap-2 text-xs text-[#718096]">
                    <UserRound className="h-3.5 w-3.5" />
                    Working with {selectedCustomer.name}
                  </div>
                ) : null}

                {messages.map((message, index) => (
                  <div
                    key={`${message.role}-${index}`}
                    className={
                      message.role === "user"
                        ? "ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-[#3F70D8] px-4 py-3 text-sm leading-6 text-white"
                        : "max-w-[92%]"
                    }
                  >
                    {message.role === "assistant" ? (
                      <div className="flex gap-3">
                        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[#EDF3FF] text-[#3F70D8]">
                          <Bot className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="whitespace-pre-wrap text-sm leading-7 text-[#33445B]">
                            {message.content}
                          </p>
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
                    <span className="grid h-8 w-8 place-items-center rounded-xl bg-[#EDF3FF] text-[#3F70D8]">
                      <Bot className="h-4 w-4" />
                    </span>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Working on that…
                  </div>
                ) : null}

                {error ? (
                  <div
                    role="alert"
                    className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
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
                <div ref={chatEnd} />
              </div>
            </div>
          </section>
        )}

        <div className="sticky bottom-3 z-20 mx-auto w-full max-w-4xl rounded-2xl border border-[#CBD7E6] bg-white p-2 shadow-[0_18px_50px_rgba(38,53,74,.16)]">
          <Textarea
            aria-label="Message Amarktai Assistant"
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder="Ask about a customer, overdue work, your next call, objections, follow-ups, company knowledge…"
            className="min-h-[64px] resize-none border-0 bg-transparent px-3 py-3 text-[15px] leading-6 shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center justify-between gap-3 border-t border-[#EEF2F6] px-2 pt-2">
            <p className="text-[11px] text-[#8290A3]">
              I choose the right sales tool automatically.
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
    </DashboardLayout>
  );
}

function Snapshot({
  icon: Icon,
  value,
  label,
  onClick,
}: {
  icon: typeof CalendarClock;
  value: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl border border-[#E1E7EF] bg-[#FAFCFF] p-3 text-left transition hover:border-[#AFC3E8]"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#EDF3FF] text-[#3F70D8]">
        <Icon className="h-4 w-4" />
      </span>
      <span>
        <strong className="block text-lg leading-5 text-[#26354A]">
          {value}
        </strong>
        <span className="text-xs text-[#718096]">{label}</span>
      </span>
    </button>
  );
}
