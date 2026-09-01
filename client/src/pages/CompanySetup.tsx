import DashboardLayout from "@/components/DashboardLayout";
import ManagementElevation from "@/components/ManagementElevation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { friendlyError } from "@/lib/friendlyError";
import {
  buildBusinessBasicsApproval,
  type WebsiteKnowledgeApprovalCandidate,
} from "@shared/companyKnowledgeApprovalPolicy";
import {
  BadgeCheck,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  PencilLine,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import Onboarding from "./Onboarding";
import Knowledge from "./Knowledge";

const SALES_FOCUS_PREFIX = "Management-confirmed sales focus. ";

function withSalesFocus(content: string, selected: boolean) {
  const cleaned = content.replace(/^Management-confirmed sales focus\.\s*/i, "").trim();
  return selected ? `${SALES_FOCUS_PREFIX}${cleaned}` : cleaned;
}

function cleanDisplayContent(content: string) {
  return content.replace(/^Management-confirmed sales focus\.\s*/i, "").trim();
}

function CompanyKnowledgeReview() {
  const utils = trpc.useUtils();
  const setup = trpc.companySetup.get.useQuery(undefined, {
    retry: false,
    refetchInterval: 3_000,
  });
  const management = trpc.managementElevation.status.useQuery(undefined, {
    retry: false,
    refetchInterval: 15_000,
  });
  const updateOnboarding = trpc.organisation.updateOnboarding.useMutation();
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [corrections, setCorrections] = useState<
    Record<number, { title: string; content: string }>
  >({});
  const [salesFocus, setSalesFocus] = useState<number[]>([]);
  const [focusInitialised, setFocusInitialised] = useState(false);

  const discovery = setup.data?.currentDiscovery ?? null;
  const candidates = (discovery?.proposedKnowledge ??
    []) as WebsiteKnowledgeApprovalCandidate[];
  const basics = useMemo(
    () => buildBusinessBasicsApproval(candidates),
    [candidates]
  );
  const company = useMemo(
    () => basics.filter(item => item.group === "company"),
    [basics]
  );
  const offerings = useMemo(
    () => basics.filter(item => item.group === "offerings"),
    [basics]
  );
  const credentials = useMemo(
    () => basics.filter(item => item.group === "credentials"),
    [basics]
  );
  const contact = useMemo(
    () => basics.filter(item => item.group === "contact"),
    [basics]
  );

  useEffect(() => {
    setCorrections(current => {
      const next = { ...current };
      for (const item of basics)
        next[item.index] ??= {
          title: item.title,
          content: cleanDisplayContent(item.content),
        };
      return next;
    });
  }, [basics]);

  useEffect(() => {
    if (focusInitialised || !offerings.length) return;
    const alreadyConfirmed = offerings
      .filter(item => /^Management-confirmed sales focus\./i.test(item.content))
      .map(item => item.index)
      .slice(0, 3);
    setSalesFocus(
      alreadyConfirmed.length
        ? alreadyConfirmed
        : offerings.slice(0, Math.min(3, offerings.length)).map(item => item.index)
    );
    setFocusInitialised(true);
  }, [focusInitialised, offerings]);

  const confirm = trpc.companySetup.confirmDiscovery.useMutation({
    onSuccess: async () => {
      await updateOnboarding.mutateAsync({ step: 3 });
      await Promise.all([
        utils.companySetup.get.invalidate(),
        utils.organisation.current.invalidate(),
      ]);
      setError("");
      toast.success("Business knowledge and sales focus confirmed.");
      window.location.assign("/company-setup");
    },
    onError: cause =>
      setError(
        friendlyError(
          cause,
          "I couldn't save that confirmation. Nothing changed, so you can safely try again."
        )
      ),
  });

  if (!discovery) return <Onboarding />;

  function toggleFocus(index: number) {
    setError("");
    setSalesFocus(current => {
      if (current.includes(index)) return current.filter(value => value !== index);
      if (current.length >= 3) {
        setError("Choose up to three primary sales focus areas.");
        return current;
      }
      return [...current, index];
    });
  }

  function saveReview() {
    if (offerings.length && !salesFocus.length) {
      setError("Choose at least one primary sales focus before continuing.");
      return;
    }
    confirm.mutate({
      discoveryId: discovery.id,
      knowledgeIndexes: basics.map(item => item.index),
      corrections: basics.map(item => {
        const correction = corrections[item.index] ?? {
          title: item.title,
          content: cleanDisplayContent(item.content),
        };
        return {
          index: item.index,
          title: correction.title.trim(),
          content: withSalesFocus(
            correction.content,
            item.group === "offerings" && salesFocus.includes(item.index)
          ),
        };
      }),
    });
  }

  const businessSummary = company[0];
  const additionalBusinessFacts = company.slice(1);
  const waiting = confirm.isPending || updateOnboarding.isPending;

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-5xl pb-12 text-[#26354A]" data-company-review>
        <header className="overflow-hidden rounded-[28px] border border-[#D8E4F1] bg-[linear-gradient(135deg,#ffffff_0%,#f3f8ff_60%,#eefaf7_100%)] p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-3xl">
              <div className="flex items-center gap-2 text-[#3473D6]">
                <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#E8F1FF]">
                  <Sparkles className="h-5 w-5" />
                </span>
                <p className="text-[11px] font-black uppercase tracking-[.16em]">
                  Business understanding
                </p>
              </div>
              <h1 className="mt-4 text-3xl font-bold tracking-[-.045em] sm:text-4xl">
                Amarktai learned your business.
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#62738A] sm:text-base">
                Here is the sales-ready understanding I built from your public website. Confirm the important parts, choose what your team should focus on, and only edit something if it is wrong.
              </p>
            </div>
            {discovery.sourceUrl ? (
              <a
                className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-[#C9DAF0] bg-white px-3 py-2 text-xs font-bold text-[#3473D6] shadow-sm transition hover:bg-[#F4F8FF]"
                href={discovery.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                Website source
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : null}
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <ReviewStat label="Business facts" value={company.length} tone="blue" />
            <ReviewStat label="Offerings understood" value={offerings.length} tone="green" />
            <ReviewStat label="Sales focus selected" value={salesFocus.length} tone="amber" />
          </div>
        </header>

        {!basics.length ? (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-semibold leading-6 text-amber-950">
            I couldn’t find enough clear business information to approve yet. Nothing has been added to trusted company knowledge.
          </div>
        ) : (
          <>
            <section className="mt-5 rounded-[24px] border border-[#D8E4F1] bg-white p-5 shadow-sm sm:p-7">
              <SectionHeading
                icon={Building2}
                eyebrow="Business summary"
                title="What I understand about your company"
                description="This is the core company context your Assistant will use from day one."
              />

              {businessSummary ? (
                <div className="mt-5 rounded-2xl bg-[#F6F9FD] p-5">
                  {editing ? (
                    <EditableKnowledge
                      item={businessSummary}
                      value={corrections[businessSummary.index]}
                      onChange={value =>
                        setCorrections(current => ({
                          ...current,
                          [businessSummary.index]: value,
                        }))
                      }
                    />
                  ) : (
                    <>
                      <h3 className="text-lg font-bold">
                        {corrections[businessSummary.index]?.title ?? businessSummary.title}
                      </h3>
                      <p className="mt-2 max-w-3xl text-sm leading-7 text-[#5E7087]">
                        {corrections[businessSummary.index]?.content ?? cleanDisplayContent(businessSummary.content)}
                      </p>
                    </>
                  )}
                </div>
              ) : null}

              {additionalBusinessFacts.length ? (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {additionalBusinessFacts.map(item => (
                    <KnowledgeFact
                      key={item.index}
                      title={corrections[item.index]?.title ?? item.title}
                      content={corrections[item.index]?.content ?? cleanDisplayContent(item.content)}
                    />
                  ))}
                </div>
              ) : null}
            </section>

            {offerings.length ? (
              <section className="mt-5 rounded-[24px] border border-[#CEE3DB] bg-[linear-gradient(180deg,#ffffff_0%,#f5fbf8_100%)] p-5 shadow-sm sm:p-7">
                <SectionHeading
                  icon={Target}
                  eyebrow="Primary sales focus"
                  title="What should your team prioritise?"
                  description="I can infer what your website emphasises, but you decide what matters most commercially. Choose up to three. CRM evidence will make this prioritisation smarter after connection."
                />

                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  {offerings.map((item, index) => {
                    const selected = salesFocus.includes(item.index);
                    const value = corrections[item.index] ?? {
                      title: item.title,
                      content: cleanDisplayContent(item.content),
                    };
                    return (
                      <button
                        key={item.index}
                        type="button"
                        onClick={() => toggleFocus(item.index)}
                        className={`relative rounded-2xl border p-5 text-left transition ${
                          selected
                            ? "border-[#4BA985] bg-white shadow-[0_12px_28px_rgba(39,115,88,.10)]"
                            : "border-[#D9E6E1] bg-white/80 hover:border-[#9CCCB9] hover:bg-white"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#5D907D]">
                              {selected ? "Primary focus" : index < 3 ? "Suggested focus" : "Offering"}
                            </p>
                            <h3 className="mt-1 text-base font-bold text-[#26354A]">
                              {value.title}
                            </h3>
                          </div>
                          <span
                            className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${
                              selected
                                ? "bg-[#2D8D69] text-white"
                                : "border border-[#C9DAD3] bg-white text-[#9AABA4]"
                            }`}
                          >
                            {selected ? <Check className="h-4 w-4" /> : null}
                          </span>
                        </div>
                        <p className="mt-3 text-sm leading-6 text-[#62738A]">
                          {value.content}
                        </p>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 rounded-xl border border-[#CFE6DD] bg-[#EAF7F2] px-4 py-3 text-xs leading-5 text-[#3C6E5C]">
                  <strong>Why this matters:</strong> your confirmed sales focus becomes trusted context for call preparation, customer prioritisation, objection handling, follow-ups and Assistant recommendations. It is not treated as a “best seller” claim unless real CRM evidence supports that later.
                </div>
              </section>
            ) : null}

            <section className="mt-5 overflow-hidden rounded-[24px] border border-[#D8E4F1] bg-white shadow-sm">
              <button
                type="button"
                onClick={() => setDetailsOpen(open => !open)}
                className="flex w-full items-center justify-between gap-4 p-5 text-left sm:p-7"
              >
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#6F83A0]">
                    Supporting knowledge
                  </p>
                  <h2 className="mt-1 text-xl font-bold tracking-[-.03em]">
                    Credentials, support and contact details
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-[#6A7B90]">
                    {credentials.length + contact.length} additional fact{credentials.length + contact.length === 1 ? "" : "s"} found. Review them without filling in a form.
                  </p>
                </div>
                {detailsOpen ? (
                  <ChevronUp className="h-5 w-5 shrink-0 text-[#6F83A0]" />
                ) : (
                  <ChevronDown className="h-5 w-5 shrink-0 text-[#6F83A0]" />
                )}
              </button>

              {detailsOpen ? (
                <div className="grid gap-5 border-t border-[#E4EBF3] bg-[#FAFCFF] p-5 sm:p-7 md:grid-cols-2">
                  <SupportingGroup title="Credentials and trust" items={credentials} corrections={corrections} />
                  <SupportingGroup title="Contact and support" items={contact} corrections={corrections} />
                </div>
              ) : null}
            </section>

            <section className="mt-5 rounded-[24px] border border-[#D8E4F1] bg-white p-5 shadow-sm sm:p-7">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <PencilLine className="h-4 w-4 text-[#4D79C8]" />
                    <h2 className="font-bold">Something wrong?</h2>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-[#6A7B90]">
                    You do not need to edit what is correct. Open editing only for facts that need correction.
                  </p>
                </div>
                <Button variant="outline" onClick={() => setEditing(value => !value)}>
                  <PencilLine className="mr-2 h-4 w-4" />
                  {editing ? "Finish editing" : "Edit details"}
                </Button>
              </div>

              {editing ? (
                <div className="mt-5 space-y-4 border-t border-[#E4EBF3] pt-5">
                  {basics.map(item => (
                    <div key={item.index} className="rounded-2xl bg-[#F7F9FC] p-4">
                      <EditableKnowledge
                        item={item}
                        value={corrections[item.index]}
                        onChange={value =>
                          setCorrections(current => ({ ...current, [item.index]: value }))
                        }
                      />
                    </div>
                  ))}
                </div>
              ) : null}
            </section>

            <section className="mt-5 rounded-[24px] border border-[#CCDFF3] bg-[linear-gradient(135deg,#f7fbff_0%,#f1f8ff_55%,#f2fbf7_100%)] p-5 shadow-sm sm:p-7">
              <div className="grid gap-6 lg:grid-cols-[1fr_360px] lg:items-start">
                <div>
                  <div className="flex items-center gap-2 text-[#3473D6]">
                    <ShieldCheck className="h-5 w-5" />
                    <h2 className="text-lg font-bold text-[#26354A]">Confirm this understanding</h2>
                  </div>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-[#62738A]">
                    Your confirmation turns these reviewed facts into trusted company knowledge. Commercial details such as pricing, finance terms and guarantees remain separately controlled and are never silently trusted.
                  </p>
                  <div className="mt-4 flex items-start gap-2 rounded-xl border border-[#D5E8DF] bg-white/80 p-3 text-xs leading-5 text-[#557063]">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#2D8D69]" />
                    The Assistant will use this business understanding together with live CRM evidence, calls, messages and durable memory to become more useful over time.
                  </div>
                </div>
                <div className="space-y-3">
                  <ManagementElevation />
                  {error ? (
                    <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-900">
                      {error}
                    </p>
                  ) : null}
                  <Button
                    className="h-11 w-full"
                    disabled={!basics.length || !management.data?.elevated || waiting}
                    onClick={saveReview}
                  >
                    {waiting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <BadgeCheck className="mr-2 h-4 w-4" />
                    )}
                    Confirm business and continue
                  </Button>
                  {!management.data?.elevated ? (
                    <p className="text-center text-xs leading-5 text-[#718197]">
                      Confirm management access before approving shared company knowledge.
                    </p>
                  ) : null}
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function ReviewStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "blue" | "green" | "amber";
}) {
  const styles = {
    blue: "border-[#D4E3F8] bg-[#EEF5FF] text-[#366AB3]",
    green: "border-[#D3EADF] bg-[#EDF8F3] text-[#35765D]",
    amber: "border-[#F0DFC3] bg-[#FFF8EB] text-[#8A672B]",
  } as const;
  return (
    <div className={`rounded-2xl border px-4 py-3 ${styles[tone]}`}>
      <strong className="block text-xl leading-none">{value}</strong>
      <span className="mt-1 block text-xs font-semibold">{label}</span>
    </div>
  );
}

function SectionHeading({
  icon: Icon,
  eyebrow,
  title,
  description,
}: {
  icon: typeof Building2;
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#EAF2FF] text-[#3D75CB]">
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#6F83A0]">{eyebrow}</p>
        <h2 className="mt-1 text-xl font-bold tracking-[-.03em] sm:text-2xl">{title}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-[#6A7B90]">{description}</p>
      </div>
    </div>
  );
}

function KnowledgeFact({ title, content }: { title: string; content: string }) {
  return (
    <div className="rounded-2xl border border-[#E1E9F2] bg-white p-4">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#4A9A78]" />
        <div>
          <h3 className="text-sm font-bold">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-[#6A7B90]">{content}</p>
        </div>
      </div>
    </div>
  );
}

function SupportingGroup({
  title,
  items,
  corrections,
}: {
  title: string;
  items: ReturnType<typeof buildBusinessBasicsApproval>;
  corrections: Record<number, { title: string; content: string }>;
}) {
  return (
    <div>
      <h3 className="text-sm font-bold text-[#40536B]">{title}</h3>
      {items.length ? (
        <div className="mt-3 space-y-3">
          {items.map(item => (
            <KnowledgeFact
              key={item.index}
              title={corrections[item.index]?.title ?? item.title}
              content={corrections[item.index]?.content ?? cleanDisplayContent(item.content)}
            />
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-[#8090A4]">No additional items found.</p>
      )}
    </div>
  );
}

function EditableKnowledge({
  item,
  value,
  onChange,
}: {
  item: ReturnType<typeof buildBusinessBasicsApproval>[number];
  value?: { title: string; content: string };
  onChange: (value: { title: string; content: string }) => void;
}) {
  const current = value ?? {
    title: item.title,
    content: cleanDisplayContent(item.content),
  };
  return (
    <div className="grid gap-2">
      <Input
        aria-label={`Title for ${item.title}`}
        value={current.title}
        onChange={event => onChange({ ...current, title: event.target.value })}
      />
      <Textarea
        aria-label={`Details for ${item.title}`}
        className="min-h-24"
        value={current.content}
        onChange={event => onChange({ ...current, content: event.target.value })}
      />
    </div>
  );
}

export default function CompanySetup() {
  const organisation = trpc.organisation.current.useQuery(undefined, {
    retry: false,
  });
  const setup = trpc.companySetup.get.useQuery(undefined, {
    retry: false,
    refetchInterval: 3_000,
  });
  const organisationId = organisation.data?.organisationId;
  const systems = trpc.connectedSystems.list.useQuery(
    { organisationId: organisationId ?? 0 },
    {
      enabled: Boolean(organisationId),
      retry: false,
      refetchInterval: 3_000,
    }
  );

  if (setup.isLoading || organisation.isLoading)
    return (
      <DashboardLayout>
        <div className="grid min-h-[40vh] place-items-center text-[#66758A]">
          <div className="flex items-center gap-3 text-sm font-semibold">
            <Loader2 className="h-5 w-5 animate-spin text-[#3F70D8]" />
            Checking your saved setup…
          </div>
        </div>
      </DashboardLayout>
    );

  if (!setup.data?.profile) return <Onboarding />;
  if (setup.data.currentDiscovery) return <CompanyKnowledgeReview />;

  const onboarding = organisation.data?.settings?.onboarding;
  const markedComplete = Boolean(
    onboarding &&
      typeof onboarding === "object" &&
      !Array.isArray(onboarding) &&
      (onboarding as { complete?: unknown }).complete === true
  );
  const crmReady = Boolean(
    systems.data?.some(
      system =>
        system.status === "ready" || system.status === "limited_permissions"
    )
  );

  if (
    markedComplete &&
    setup.data.profile.discoveryStatus === "confirmed" &&
    crmReady
  )
    return <Knowledge />;

  return <Onboarding />;
}
