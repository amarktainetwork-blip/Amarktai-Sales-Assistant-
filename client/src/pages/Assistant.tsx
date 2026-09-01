import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/_core/hooks/useAuth";
import { friendlyError } from "@/lib/friendlyError";
import { trpc } from "@/lib/trpc";
import { ArrowRight, Loader2, RotateCcw, Send, UserRound } from "lucide-react";
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
  "Who should I contact next?",
  "Prepare my next call",
  "What needs my attention?",
  "Draft a follow-up",
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

function AssistantMark({ compact = false }: { compact?: boolean }) {
  const size = compact ? "h-8 w-8 rounded-lg text-[10px]" : "h-10 w-10 rounded-xl text-[12px]";
  return (
    <span
      aria-label="Amarktai AI"
      className={`${size} grid shrink-0 place-items-center bg-gradient-to-br from-[#2F6FED] to-[#5D8DF4] font-black tracking-[-.04em] text-white shadow-[0_8px_20px_rgba(47,111,237,.20)]`}
    >
      <span>
        A<span className="text-[#DCE8FF]">I</span>
      </span>
    </span>
  );
}

export default function Assistant() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const customers = trpc.sales.customers.useQuery();
  const organisation = trpc.organisation.current.useQuery();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [contactId, setContactId] = useState<number | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chatEnd = useRef<HTMLDivElement>(null);

  const firstName =
    organisation.data?.memberOnboarding.preferredName ||
    user?.name?.trim().split(/\s+/)[0] ||
    "there";
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

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";

  return (
    <DashboardLayout>
      <div
        data-assistant-workspace
        className="mx-auto flex h-[calc(100dvh-104px)] min-h-[560px] max-w-5xl flex-col overflow-hidden text-[#24344A]"
      >
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[#D7E0EA] pb-4">
          <div className="flex min-w-0 items-center gap-3">
            <AssistantMark />
            <div className="min-w-0">
              <p className="text-sm font-black tracking-[-.01em] text-[#24344A]">
                Amarktai <span className="text-[#2F6FED]">AI</span>
              </p>
              <h1 className="truncate text-sm font-medium text-[#6B7B90]">
                Good {greeting}, {firstName}.
              </h1>
            </div>
          </div>

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
              className="h-9 max-w-[min(52vw,300px)] truncate rounded-xl border border-[#CAD6E4] bg-white px-3 text-xs font-semibold text-[#33445B] outline-none focus:border-[#2F6FED] focus:ring-2 focus:ring-[#DCE7F6]"
            >
              <option value="">All customers</option>
              {customers.data?.map(customer => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                  {customer.companyName ? ` · ${customer.companyName}` : ""}
                </option>
              ))}
            </select>
          </label>
        </header>

        <section className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#D7E0EA] bg-white">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-7 sm:py-6">
            <div className="mx-auto flex min-h-full max-w-3xl flex-col">
              {!messages.length ? (
                <div className="flex max-w-2xl items-start gap-3 pt-3">
                  <AssistantMark compact />
                  <div className="min-w-0 flex-1">
                    <div className="rounded-2xl rounded-tl-md bg-[#F4F7FB] px-4 py-3 text-[15px] leading-7 text-[#33445B]">
                      Good {greeting}, {firstName}. I’m ready when you are. Ask me about a customer, what needs attention, your next call or a follow-up.
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
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {selectedCustomer ? (
                    <p className="flex items-center gap-2 text-xs font-semibold text-[#718096]">
                      <UserRound className="h-3.5 w-3.5" />
                      Working with {selectedCustomer.name}
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
                      Thinking with your current context…
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

          <div className="shrink-0 border-t border-[#E5EAF0] bg-[#FAFCFF] p-3 sm:p-4">
            <div className="mx-auto max-w-3xl rounded-2xl border border-[#CBD7E6] bg-white p-2 focus-within:border-[#8AACE6] focus-within:ring-2 focus-within:ring-[#E5EDFB]">
              <Textarea
                aria-label="Message Amarktai AI"
                value={draft}
                onChange={event => setDraft(event.target.value)}
                onKeyDown={event => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder="Message Amarktai AI…"
                className="min-h-[62px] resize-none border-0 bg-transparent px-3 py-3 text-[15px] leading-6 shadow-none focus-visible:ring-0"
              />
              <div className="flex items-center justify-between gap-3 border-t border-[#EEF2F6] px-2 pt-2">
                <p className="text-[11px] text-[#8290A3]">
                  Important customer actions stay reviewable.
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
    </DashboardLayout>
  );
}
