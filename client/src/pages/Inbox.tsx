import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import {
  AlertCircle,
  Mail,
  RefreshCw,
  Reply,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

function categoryOf(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? String((value as Record<string, unknown>).category || "")
    : "";
}

function readableMessage(body: string) {
  if (typeof DOMParser === "undefined") return body.slice(0, 12_000);
  const doc = new DOMParser().parseFromString(body, "text/html");
  doc.querySelectorAll("blockquote, style, script, head, img, .gmail_quote").forEach(node => node.remove());
  return (doc.body.textContent || body)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 12_000);
}

export default function Inbox() {
  const [, navigate] = useLocation();
  const organisation = trpc.organisation.current.useQuery();
  const organisationId = organisation.data?.organisationId;
  const utils = trpc.useUtils();
  const inbox = trpc.sales.inbox.useQuery(
    { organisationId: organisationId ?? 0, limit: 75 },
    {
      enabled: Boolean(organisationId),
      retry: false,
      refetchInterval: 15_000,
      refetchIntervalInBackground: true,
      refetchOnWindowFocus: true,
    }
  );
  const syncInbox = trpc.sales.syncInbox.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.sales.inbox.invalidate(),
        utils.sales.today.invalidate(),
      ]);
      toast.success("Inbox checked against the connected sales mailbox.");
    },
    onError: () =>
      toast.warning("Inbox refresh is busy. The last synchronized messages remain available."),
  });
  const messages = inbox.data?.messages ?? [];
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    if (!messages.length) setSelectedId(null);
    else if (!messages.some(message => message.id === selectedId))
      setSelectedId(messages[0].id);
  }, [messages, selectedId]);

  const selected = useMemo(
    () => messages.find(message => message.id === selectedId) ?? messages[0],
    [messages, selectedId]
  );
  const selectedCategory = categoryOf(selected?.classification);
  const selectedText = selected ? readableMessage(selected.body) : "";
  const draftReply = () => {
    if (!selected) return;
    const prompt = [
      `Draft a reply to this ${selected.channel} from ${selected.senderReference}.`,
      `Subject: ${selected.subject || "No subject"}`,
      `Customer message: ${selectedText.slice(0, 2_500)}`,
      "Use the customer and CRM context, keep it concise and helpful, and do not send anything. Put the draft into Review.",
    ].join("\n\n");
    navigate(
      `/assistant?${selected.contact?.id ? `contactId=${selected.contact.id}&` : ""}prompt=${encodeURIComponent(prompt)}`
    );
  };

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-[1380px] space-y-5 text-[#26354A]">
        <header className="flex flex-col gap-4 rounded-3xl border border-[#DCE4EE] bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#2F6FED]">
              Sales inbox
            </p>
            <h1 className="mt-2 font-display text-4xl font-bold tracking-[-.05em]">
              Customer replies, without the CRM hunt.
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#66758A]">
              Read incoming sales messages here. AmarktAI can prepare the reply and customer admin, but nothing is sent without Review approval.
            </p>
          </div>
          <Button
            variant="outline"
            disabled={!organisationId || syncInbox.isPending}
            onClick={() =>
              organisationId && syncInbox.mutate({ organisationId })
            }
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${syncInbox.isPending ? "animate-spin" : ""}`} />
            Check inbox now
          </Button>
        </header>

        <section className="grid gap-3 sm:grid-cols-3">
          <InboxMetric label="Recent messages" value={messages.length} />
          <InboxMetric label="Need action" value={inbox.data?.needsActionCount ?? 0} />
          <InboxMetric label="Possible sales" value={inbox.data?.saleIntentCount ?? 0} />
        </section>

        <section className="grid min-h-[590px] gap-5 xl:grid-cols-[430px_1fr]">
          <div className="overflow-hidden rounded-3xl border border-[#DCE4EE] bg-white shadow-sm">
            <div className="border-b border-[#E6EBF2] px-5 py-4">
              <h2 className="font-display text-2xl font-bold tracking-[-.04em]">Latest messages</h2>
              <p className="mt-1 text-xs text-[#7A899C]">Newest source messages appear first.</p>
            </div>
            {inbox.isLoading ? (
              <p className="p-6 text-sm text-[#66758A]">Loading the sales inbox…</p>
            ) : messages.length ? (
              <div className="max-h-[620px] divide-y divide-[#EDF1F5] overflow-y-auto">
                {messages.map(message => {
                  const category = categoryOf(message.classification);
                  return (
                    <button
                      key={message.id}
                      type="button"
                      onClick={() => setSelectedId(message.id)}
                      className={`w-full px-5 py-4 text-left transition ${message.id === selected?.id ? "bg-[#F1F6FF]" : "hover:bg-[#FAFCFF]"}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate font-bold text-[#26354A]">{message.contact?.name || message.senderReference}</span>
                        {category === "sale_intent" ? (
                          <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-[.08em] text-emerald-800">Possible sale</span>
                        ) : message.needsAction ? (
                          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">Reply</span>
                        ) : null}
                      </div>
                      <p className="mt-1 truncate text-sm font-semibold text-[#526985]">{message.subject || `${message.channel.toUpperCase()} message`}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#8290A3]">{readableMessage(message.body).slice(0, 180)}</p>
                      <p className="mt-2 text-[11px] font-semibold text-[#9AA6B5]">{new Date(message.receivedAt).toLocaleString()}</p>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="p-8 text-center text-sm text-[#66758A]">
                <Mail className="mx-auto mb-3 h-7 w-7 text-[#2F6FED]" />
                No synchronized sales messages yet.
              </div>
            )}
          </div>

          <article className="rounded-3xl border border-[#DCE4EE] bg-white p-6 shadow-sm">
            {selected ? (
              <>
                <div className="flex flex-col gap-4 border-b border-[#E6EBF2] pb-5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-black uppercase tracking-[.12em] text-[#2F6FED]">{selected.channel}</span>
                      {selectedCategory === "sale_intent" ? (
                        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">Possible sale / payment step</span>
                      ) : selected.needsAction ? (
                        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">Needs reply</span>
                      ) : null}
                    </div>
                    <h2 className="mt-3 font-display text-3xl font-bold tracking-[-.045em]">{selected.subject || "Customer message"}</h2>
                    <p className="mt-2 text-sm text-[#66758A]">From <strong className="text-[#33445B]">{selected.senderReference}</strong> · {new Date(selected.receivedAt).toLocaleString()}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selected.contact?.id ? (
                      <Button variant="outline" onClick={() => navigate(`/customers?contactId=${selected.contact!.id}`)}>
                        <UserRound className="mr-2 h-4 w-4" /> Customer
                      </Button>
                    ) : null}
                    <Button onClick={draftReply}>
                      <Reply className="mr-2 h-4 w-4" /> Draft reply
                    </Button>
                  </div>
                </div>

                <div className="mt-6 rounded-2xl border border-[#E2E8F0] bg-[#FAFCFF] p-5 sm:p-6">
                  <p className="whitespace-pre-wrap text-sm leading-7 text-[#33445B]">{selectedText || "This message has no readable body."}</p>
                </div>

                <div className="mt-5 flex items-start gap-3 rounded-2xl bg-[#F3F7FF] p-4 text-sm leading-6 text-[#526985]">
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#2F6FED]" />
                  <p>Reading this message does not mark anything read in the CRM and does not send a response. Draft reply prepares work for Review only.</p>
                </div>
              </>
            ) : (
              <div className="grid min-h-[480px] place-items-center text-center text-sm text-[#66758A]">
                Select a message to read it here.
              </div>
            )}
          </article>
        </section>
      </div>
    </DashboardLayout>
  );
}

function InboxMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-[#DCE4EE] bg-white px-5 py-4 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-[.1em] text-[#8290A3]">{label}</p>
      <p className="mt-1 font-display text-3xl font-bold tracking-[-.04em] text-[#26354A]">{value}</p>
    </div>
  );
}
