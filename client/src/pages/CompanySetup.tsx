import DashboardLayout from "@/components/DashboardLayout";
import ManagementElevation from "@/components/ManagementElevation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { friendlyError } from "@/lib/friendlyError";
import {
  buildBusinessBasicsApproval,
  buildSalesFocusSuggestions,
  websiteKnowledgeNeedsCommercialReview,
  type WebsiteKnowledgeApprovalCandidate,
} from "@shared/companyKnowledgeApprovalPolicy";
import {
  BadgeCheck,
  Check,
  ChevronDown,
  Loader2,
  Pencil,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import Onboarding from "./Onboarding";
import Knowledge from "./Knowledge";

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
  const [corrections, setCorrections] = useState<
    Record<number, { title: string; content: string }>
  >({});
  const [editing, setEditing] = useState(false);
  const [selectedFocus, setSelectedFocus] = useState<number[]>([]);

  const discovery = setup.data?.currentDiscovery ?? null;
  const candidates = (discovery?.proposedKnowledge ??
    []) as WebsiteKnowledgeApprovalCandidate[];
  const basics = useMemo(
    () => buildBusinessBasicsApproval(candidates),
    [candidates]
  );
  const salesFocus = useMemo(
    () => buildSalesFocusSuggestions(candidates, 3),
    [candidates]
  );
  const companyFacts = basics.filter(item => item.group === "company");
  const offerings = basics.filter(item => item.group === "offerings");
  const credentials = basics.filter(item => item.group === "credentials");
  const contacts = basics.filter(item => item.group === "contact");
  const commercial = candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(item => websiteKnowledgeNeedsCommercialReview(item.candidate));

  useEffect(() => {
    setCorrections(current => {
      const next = { ...current };
      for (const item of basics)
        next[item.index] ??= { title: item.title, content: item.content };
      return next;
    });
  }, [basics]);

  useEffect(() => {
    setSelectedFocus(current =>
      current.length ? current : salesFocus.map(item => item.index)
    );
  }, [salesFocus]);

  function toggleFocus(index: number) {
    setSelectedFocus(current =>
      current.includes(index)
        ? current.filter(item => item !== index)
        : current.length < 3
          ? [...current, index]
          : current
    );
  }

  const confirm = trpc.companySetup.confirmDiscovery.useMutation({
    onSuccess: async () => {
      await updateOnboarding.mutateAsync({ step: 3 });
      await Promise.all([
        utils.companySetup.get.invalidate(),
        utils.organisation.current.invalidate(),
      ]);
      setError("");
      toast.success("Business knowledge confirmed.");
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

  return (
    <DashboardLayout>
      <div
        data-company-knowledge-report
        className="mx-auto max-w-5xl space-y-5 text-[#26354A]"
      >
        <header className="rounded-3xl border border-[#DCE4EE] bg-white p-5 shadow-sm sm:p-8">
          <div className="flex items-start gap-4">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
              <BadgeCheck className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[.14em] text-emerald-700">
                AmarktAI learned your business
              </p>
              <h1 className="mt-1 text-3xl font-bold tracking-[-.04em]">
                Here is what I understood.
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[#66758A]">
                Read this as a report first. If something is wrong, edit only
                that part. Then confirm the shared business knowledge your team
                can trust.
              </p>
            </div>
          </div>
        </header>

        {!basics.length ? (
          <article className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950">
            I couldn’t find enough clear business basics to confirm yet. Nothing
            has been added to trusted knowledge.
          </article>
        ) : editing ? (
          <section className="space-y-3 rounded-3xl border border-[#DCE4EE] bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#3F70D8]">
                  Specific corrections
                </p>
                <h2 className="mt-1 text-xl font-bold">
                  Edit what needs changing
                </h2>
              </div>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Done editing
              </Button>
            </div>
            {basics.map(item => (
              <div
                key={item.index}
                className="rounded-2xl border border-[#E2E8F0] bg-[#FAFCFF] p-4"
              >
                <Input
                  aria-label={`Title for ${item.title}`}
                  value={corrections[item.index]?.title ?? item.title}
                  onChange={event =>
                    setCorrections(current => ({
                      ...current,
                      [item.index]: {
                        title: event.target.value,
                        content: current[item.index]?.content ?? item.content,
                      },
                    }))
                  }
                />
                <Textarea
                  aria-label={`Details for ${item.title}`}
                  className="mt-2 min-h-24"
                  value={corrections[item.index]?.content ?? item.content}
                  onChange={event =>
                    setCorrections(current => ({
                      ...current,
                      [item.index]: {
                        title: current[item.index]?.title ?? item.title,
                        content: event.target.value,
                      },
                    }))
                  }
                />
              </div>
            ))}
          </section>
        ) : (
          <div className="space-y-5">
            <section className="rounded-3xl border border-[#DCE4EE] bg-white p-5 shadow-sm sm:p-6">
              <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#6B7A90]">
                About your business
              </p>
              <p className="mt-3 max-w-4xl text-base leading-7 text-[#40516A]">
                {companyFacts[0]?.content ||
                  "The website did not provide a clear company overview."}
              </p>
            </section>

            <section className="rounded-3xl border border-[#BFD1EE] bg-[#F4F8FF] p-5 shadow-sm sm:p-6">
              <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#2F63C7]">
                Primary sales focus
              </p>
              <h2 className="mt-1 text-xl font-bold">
                Choose up to three priorities
              </h2>
              <p className="mt-2 text-sm leading-6 text-[#66758A]">
                These are suggestions based on website prominence and depth, not
                a claim about sales volume.
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {salesFocus.map(item => (
                  <button
                    key={item.index}
                    type="button"
                    aria-pressed={selectedFocus.includes(item.index)}
                    onClick={() => toggleFocus(item.index)}
                    className={`rounded-2xl border p-4 text-left transition ${selectedFocus.includes(item.index) ? "border-[#3F70D8] bg-white shadow-sm" : "border-[#D4DFEF] bg-[#F9FBFF]"}`}
                  >
                    <span className="flex items-center gap-2 font-bold">
                      <span
                        className={`grid h-5 w-5 place-items-center rounded-full ${selectedFocus.includes(item.index) ? "bg-[#3F70D8] text-white" : "border border-[#AAB8CB]"}`}
                      >
                        {selectedFocus.includes(item.index) ? (
                          <Check className="h-3 w-3" />
                        ) : null}
                      </span>
                      {corrections[item.index]?.title ?? item.title}
                    </span>
                    <span className="mt-2 block text-xs leading-5 text-[#66758A]">
                      {item.reason}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-[#DCE4EE] bg-white p-5 shadow-sm sm:p-6">
              <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#6B7A90]">
                What you sell
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {offerings.slice(0, 6).map(item => (
                  <article
                    key={item.index}
                    className="rounded-2xl border border-[#E2E8F0] bg-[#FAFCFF] p-4"
                  >
                    <h3 className="font-bold">
                      {corrections[item.index]?.title ?? item.title}
                    </h3>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#66758A]">
                      {corrections[item.index]?.content ?? item.content}
                    </p>
                  </article>
                ))}
              </div>
              {offerings.length > 6 ? (
                <details className="mt-4 rounded-2xl border border-[#E2E8F0]">
                  <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-bold">
                    Other products &amp; services{" "}
                    <ChevronDown className="h-4 w-4" />
                  </summary>
                  <div className="grid gap-3 border-t border-[#E2E8F0] p-4 md:grid-cols-2">
                    {offerings.slice(6).map(item => (
                      <article key={item.index}>
                        <h3 className="font-bold">
                          {corrections[item.index]?.title ?? item.title}
                        </h3>
                        <p className="mt-1 text-sm leading-6 text-[#66758A]">
                          {corrections[item.index]?.content ?? item.content}
                        </p>
                      </article>
                    ))}
                  </div>
                </details>
              ) : null}
            </section>

            <div className="grid gap-5 md:grid-cols-2">
              <ReportSection
                title="Who you sell to"
                items={offerings.filter(item =>
                  /best suited to:/i.test(item.content)
                )}
                corrections={corrections}
                empty="No clear target-customer description was found."
              />
              <ReportSection
                title="Credentials & trust"
                items={credentials}
                corrections={corrections}
                empty="No public credentials were identified."
              />
              <ReportSection
                title="Customer support & contact"
                items={contacts}
                corrections={corrections}
                empty="No clear public support or contact facts were identified."
              />
              <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-sm sm:p-6">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[.14em] text-amber-800">
                      Important commercial information
                    </p>
                    <p className="mt-2 text-sm leading-6 text-amber-950">
                      {commercial.length
                        ? `${commercial.length} price, finance, guarantee or other commercial item${commercial.length === 1 ? "" : "s"} remain protected and are not trusted by this confirmation.`
                        : "No protected price, finance or guarantee claims were included in this review."}
                    </p>
                  </div>
                </div>
              </section>
            </div>

            <details className="rounded-3xl border border-[#DCE4EE] bg-white shadow-sm">
              <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-bold">
                Sources <ChevronDown className="h-4 w-4" />
              </summary>
              <div className="border-t border-[#E5EAF0] px-5 py-4 text-sm text-[#66758A]">
                {discovery.sourceUrl ? (
                  <a
                    className="font-semibold text-[#3F70D8] hover:underline"
                    href={discovery.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {discovery.sourceUrl}
                  </a>
                ) : (
                  "The authorised website source is retained with this discovery."
                )}
                <p className="mt-2">
                  {candidates.length} evidence-backed knowledge item
                  {candidates.length === 1 ? "" : "s"} were reviewed.
                </p>
              </div>
            </details>
          </div>
        )}

        <section className="rounded-3xl border border-[#DCE4EE] bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-xl font-bold">
            Is this an accurate understanding of your business?
          </h2>
          <p className="mt-2 text-sm leading-6 text-[#66758A]">
            Management confirmation shares the approved facts and selected sales
            focus with the team. It never asks for CRM credentials.
          </p>
          <div className="mt-5 max-w-full overflow-hidden">
            <ManagementElevation />
          </div>
          {error ? (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-900"
            >
              {error}
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-3">
            <Button
              variant="outline"
              onClick={() => setEditing(value => !value)}
            >
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </Button>
            <Button
              disabled={
                !basics.length ||
                !management.data?.elevated ||
                confirm.isPending ||
                updateOnboarding.isPending
              }
              onClick={() =>
                confirm.mutate({
                  discoveryId: discovery.id,
                  knowledgeIndexes: basics.map(item => item.index),
                  corrections: basics.map(item => {
                    const correction = corrections[item.index] ?? {
                      title: item.title,
                      content: item.content,
                    };
                    return {
                      index: item.index,
                      title: correction.title,
                      content: selectedFocus.includes(item.index)
                        ? `${correction.content}\n\nManager-confirmed primary sales focus.`
                        : correction.content,
                    };
                  }),
                })
              }
            >
              {confirm.isPending || updateOnboarding.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Confirm business knowledge
            </Button>
          </div>
          {!management.data?.elevated ? (
            <p className="mt-3 text-xs leading-5 text-[#66758A]">
              Confirm management access above before approving shared company
              knowledge.
            </p>
          ) : null}
        </section>
      </div>
    </DashboardLayout>
  );
}

function ReportSection({
  title,
  items,
  corrections,
  empty,
}: {
  title: string;
  items: Array<{ index: number; title: string; content: string }>;
  corrections: Record<number, { title: string; content: string }>;
  empty: string;
}) {
  return (
    <section className="rounded-3xl border border-[#DCE4EE] bg-white p-5 shadow-sm sm:p-6">
      <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#6B7A90]">
        {title}
      </p>
      <div className="mt-3 space-y-3">
        {items.length ? (
          items.map(item => (
            <article key={item.index}>
              <h3 className="text-sm font-bold">
                {corrections[item.index]?.title ?? item.title}
              </h3>
              <p className="mt-1 text-sm leading-6 text-[#66758A]">
                {corrections[item.index]?.content ?? item.content}
              </p>
            </article>
          ))
        ) : (
          <p className="text-sm leading-6 text-[#8290A3]">{empty}</p>
        )}
      </div>
    </section>
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

  // Completion is only presentation state. The real setup contract is a
  // confirmed business profile plus a backend-verified CRM. Never let a stale
  // organisation flag skip the CRM sign-in/commissioning step.
  if (
    markedComplete &&
    setup.data.profile.discoveryStatus === "confirmed" &&
    crmReady
  )
    return <Knowledge />;

  return <Onboarding />;
}
