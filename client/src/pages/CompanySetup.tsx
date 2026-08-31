import DashboardLayout from "@/components/DashboardLayout";
import ManagementElevation from "@/components/ManagementElevation";
import WorkflowFeedback, {
  type WorkflowFeedbackState,
} from "@/components/WorkflowFeedback";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import {
  buildBusinessBasicsApproval,
  businessBasicsCounts,
  websiteKnowledgeNeedsCommercialReview,
  type WebsiteKnowledgeApprovalCandidate,
} from "@shared/companyKnowledgeApprovalPolicy";
import { BadgeCheck, Building2, Network, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import Onboarding from "./Onboarding";

type WebsiteCompleteness = {
  status?: "complete" | "complete_with_conflicts" | "incomplete";
  pagesScanned?: number;
  pagesUsed?: number;
  careerProgrammesDiscovered?: number;
  individualCoursesDiscovered?: number;
  finalProposedOfferings?: number;
  importantGaps?: string[];
};

type WebsiteConflict = {
  type?: string;
  displayNames?: string[];
  values?: string[];
  sources?: Array<{
    sourceUrl: string;
    fetchedAt?: string;
    prices?: string[];
  }>;
};

function ReviewCard({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-[1.75rem] border border-white/10 bg-[#0C1E3E] p-6 sm:p-8">
      {children}
    </section>
  );
}

function labelForGroup(group: "company" | "offerings" | "credentials" | "contact") {
  return (
    {
      company: "Business identity",
      offerings: "Products / services",
      credentials: "Credentials",
      contact: "Contact / support",
    } as const
  )[group];
}

function CompanyKnowledgeReview() {
  const utils = trpc.useUtils();
  const setup = trpc.companySetup.get.useQuery(undefined, {
    retry: false,
    refetchInterval: 3_000,
  });
  const managementStatus = trpc.managementElevation.status.useQuery(undefined, {
    retry: false,
    refetchInterval: 15_000,
  });
  const onboardingProgress = trpc.organisation.updateOnboarding.useMutation();
  const [feedback, setFeedback] = useState<WorkflowFeedbackState | null>(null);

  const discovery = setup.data?.currentDiscovery ?? null;
  const candidates = (discovery?.proposedKnowledge ?? []) as WebsiteKnowledgeApprovalCandidate[];
  const facts = (discovery?.proposedFacts ?? {}) as {
    completeness?: WebsiteCompleteness;
    conflicts?: WebsiteConflict[];
  };
  const completeness = facts.completeness ?? {};
  const conflicts = facts.conflicts ?? [];

  const basics = useMemo(() => buildBusinessBasicsApproval(candidates), [candidates]);
  const counts = useMemo(() => businessBasicsCounts(basics), [basics]);
  const commercialDeferred = useMemo(
    () => candidates.filter(candidate => websiteKnowledgeNeedsCommercialReview(candidate)).length,
    [candidates]
  );

  const confirm = trpc.companySetup.confirmDiscovery.useMutation({
    onMutate: () =>
      setFeedback({
        kind: "loading",
        title: "Confirming business basics",
        detail:
          "Only the safe business identities shown below are being promoted to trusted knowledge. Commercial website claims remain untrusted.",
      }),
    onSuccess: async () => {
      await onboardingProgress.mutateAsync({ step: 3 });
      await Promise.all([
        utils.companySetup.get.invalidate(),
        utils.organisation.current.invalidate(),
      ]);
      toast.success("Business basics confirmed. Continue with your CRM.");
      window.location.assign("/company-setup");
    },
    onError: error =>
      setFeedback({
        kind: "error",
        title: "Business basics were not confirmed",
        detail: `Nothing new became trusted knowledge. ${error.message}`,
      }),
  });

  if (!discovery) return <Onboarding />;

  const incomplete = completeness.status === "incomplete";
  const groups = (["company", "offerings", "credentials", "contact"] as const).map(
    group => ({ group, items: basics.filter(item => item.group === group) })
  );

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-5xl space-y-6 text-[#EEF5FF]">
        <ReviewCard>
          <p className="text-[10px] font-black uppercase tracking-[.16em] text-[#83AEFF]">
            Organisation intelligence
          </p>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-[-.05em] text-white sm:text-5xl">
            Your business is <span className="text-[#83AEFF]">understood.</span>
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-[#B7CAE7]">
            Confirm the small set of business basics Amarktai needs to support sales work, then move on to the CRM. Prices, finance, salaries, guarantees and package terms are deliberately not imported as trusted facts from the website.
          </p>
        </ReviewCard>

        <ManagementElevation />
        <WorkflowFeedback state={feedback} />

        <ReviewCard>
          <div className="flex gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#153B7A] text-[#9FC2FF]">
              <BadgeCheck size={18} />
            </span>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[.15em] text-[#83AEFF]">
                Step 02
              </p>
              <h2 className="mt-1 font-display text-2xl font-bold text-white">
                Confirm business basics
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[#A9BFDF]">
                The full website analysis remains preserved as evidence. This screen keeps onboarding focused on facts your agents actually need before CRM commissioning.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ["Business", counts.company],
              ["Offerings", counts.offerings],
              ["Credentials", counts.credentials],
              ["Contact", counts.contact],
              ["Commercial deferred", commercialDeferred],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-white/10 bg-[#071326] p-4">
                <p className="text-[10px] font-black uppercase tracking-[.1em] text-[#7896C1]">
                  {label}
                </p>
                <p className="mt-1 text-2xl font-bold text-white">{value}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-xl border border-emerald-300/20 bg-emerald-400/[.06] p-4">
            <div className="flex gap-3">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-200" />
              <div>
                <p className="font-bold text-emerald-100">Commercial truth stays human-owned</p>
                <p className="mt-1 text-sm leading-6 text-[#C7D6EC]">
                  Website prices and package structures are retained only as background evidence. They are not included in this approval, will not block setup, and should be added later from an authoritative human or system source. Agents must work from the approved business basics until commercial details are deliberately supplied.
                </p>
              </div>
            </div>
          </div>

          <details className="mt-5 rounded-xl border border-white/10 bg-[#08172F] p-4">
            <summary className="cursor-pointer font-bold text-[#A9C7FF]">
              Review the business basics ({basics.length})
            </summary>
            <div className="mt-4 max-h-[28rem] space-y-4 overflow-auto pr-1">
              {groups.map(({ group, items }) =>
                items.length ? (
                  <section key={group}>
                    <h3 className="sticky top-0 bg-[#08172F] py-2 text-sm font-black uppercase tracking-[.1em] text-[#83AEFF]">
                      {labelForGroup(group)} · {items.length}
                    </h3>
                    <div className="space-y-2">
                      {items.map(item => (
                        <div
                          key={`${item.index}-${item.title}`}
                          className="rounded-lg border border-white/10 bg-[#071326] px-3 py-2"
                        >
                          <p className="text-sm font-bold text-white">{item.title}</p>
                          <p className="mt-1 text-xs leading-5 text-[#91A9CF]">{item.content}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null
              )}
              {!basics.length && (
                <p className="text-sm text-amber-100">
                  No safe business basics were found. Nothing can be approved from this review.
                </p>
              )}
            </div>
          </details>

          {!managementStatus.data?.elevated && (
            <p className="mt-4 text-sm text-amber-100">
              Re-verify sensitive management mode above to make the one deliberate company-knowledge approval.
            </p>
          )}

          <Button
            disabled={
              confirm.isPending ||
              onboardingProgress.isPending ||
              incomplete ||
              !basics.length ||
              !managementStatus.data?.elevated
            }
            onClick={() =>
              confirm.mutate({
                discoveryId: discovery.id,
                knowledgeIndexes: basics.map(item => item.index),
                corrections: basics.map(item => ({
                  index: item.index,
                  title: item.title,
                  content: item.content,
                })),
              })
            }
            className="mt-5 bg-[#1B64F2]"
          >
            Confirm business basics and connect CRM
          </Button>
        </ReviewCard>

        <ReviewCard>
          <details>
            <summary className="cursor-pointer text-sm font-bold text-[#9FC2FF]">
              Advanced website audit — not required for setup
            </summary>
            <p className="mt-3 text-xs leading-5 text-[#91A9CF]">
              The detailed crawl and audit remain available for administrators, but they do not need to be resolved before CRM and agent commissioning.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Pages scanned", completeness.pagesScanned ?? 0],
                ["Pages used", completeness.pagesUsed ?? 0],
                ["Offerings found", completeness.finalProposedOfferings ?? 0],
                ["Website conflicts", conflicts.length],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-lg bg-[#071326] p-3">
                  <p className="text-[10px] font-black uppercase tracking-[.1em] text-[#7896C1]">{label}</p>
                  <p className="mt-1 text-xl font-bold text-white">{value}</p>
                </div>
              ))}
            </div>

            {conflicts.length > 0 && (
              <details className="mt-4 rounded-lg border border-white/10 p-3">
                <summary className="cursor-pointer text-xs font-bold text-amber-100">
                  Website conflicts retained for later review ({conflicts.length})
                </summary>
                <div className="mt-3 max-h-60 space-y-2 overflow-auto">
                  {conflicts.map((conflict, index) => (
                    <div key={`${conflict.type || "conflict"}-${index}`} className="rounded-lg bg-[#071326] p-3 text-xs text-[#A9BFDF]">
                      <p className="font-bold text-white">
                        {(conflict.displayNames || []).join(" / ") || "Website fact"}
                      </p>
                      <p className="mt-1">{(conflict.values || []).join(" versus ")}</p>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {(completeness.importantGaps?.length ?? 0) > 0 && (
              <details className="mt-4 rounded-lg border border-white/10 p-3">
                <summary className="cursor-pointer text-xs font-bold text-[#9FC2FF]">
                  Technical audit notes ({completeness.importantGaps?.length ?? 0})
                </summary>
                <ul className="mt-3 max-h-72 list-disc space-y-2 overflow-auto pl-5 text-xs leading-5 text-[#91A9CF]">
                  {completeness.importantGaps?.map((gap, index) => (
                    <li key={`${index}-${gap.slice(0, 32)}`}>{gap}</li>
                  ))}
                </ul>
              </details>
            )}
          </details>
        </ReviewCard>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-[#0C1E3E] p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Building2 className="size-4 text-[#83AEFF]" /> Business learning
            </div>
            <p className="mt-2 text-xs text-emerald-200">Complete and retained</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#0C1E3E] p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Network className="size-4 text-[#83AEFF]" /> Next: CRM commissioning
            </div>
            <p className="mt-2 text-xs text-[#A9BFDF]">Confirm the basics once, then continue directly to Genie or your chosen CRM.</p>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

export default function CompanySetup() {
  const setup = trpc.companySetup.get.useQuery(undefined, {
    retry: false,
    refetchInterval: 3_000,
  });

  if (setup.data?.currentDiscovery) return <CompanyKnowledgeReview />;
  return <Onboarding />;
}
