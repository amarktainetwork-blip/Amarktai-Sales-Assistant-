import DashboardLayout from "@/components/DashboardLayout";
import ManagementElevation from "@/components/ManagementElevation";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import {
  buildBusinessBasicsApproval,
  type WebsiteKnowledgeApprovalCandidate,
} from "@shared/companyKnowledgeApprovalPolicy";
import {
  BadgeCheck,
  Check,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import Onboarding from "./Onboarding";

const groupLabels = {
  company: "Your business",
  offerings: "What you offer",
  credentials: "Credentials",
  contact: "Contact and support",
} as const;

function friendlyError() {
  return "I couldn't save that confirmation. Nothing changed, so you can safely try again.";
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

  const discovery = setup.data?.currentDiscovery ?? null;
  const candidates = (discovery?.proposedKnowledge ?? []) as WebsiteKnowledgeApprovalCandidate[];
  const basics = useMemo(() => buildBusinessBasicsApproval(candidates), [candidates]);
  const groups = useMemo(
    () =>
      (["company", "offerings", "credentials", "contact"] as const)
        .map(group => ({
          group,
          items: basics.filter(item => item.group === group),
        }))
        .filter(group => group.items.length),
    [basics]
  );

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
    onError: () => setError(friendlyError()),
  });

  if (!discovery) return <Onboarding />;

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-5xl text-[#26354A]">
        <header className="rounded-3xl border border-[#DCE4EE] bg-white p-6 shadow-sm sm:p-8">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
              <BadgeCheck className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[.16em] text-emerald-700">
                Business review
              </p>
              <h1 className="mt-2 font-display text-4xl font-bold tracking-[-.06em] sm:text-5xl">
                Here’s what I learned about your business.
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-6 text-[#66758A]">
                Check these basics once. They become the trusted company context I use when helping your sales team.
              </p>
            </div>
          </div>
        </header>

        <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_300px]">
          <section className="space-y-4">
            {groups.map(({ group, items }) => (
              <article key={group} className="rounded-3xl border border-[#DCE4EE] bg-white p-5 shadow-sm sm:p-6">
                <h2 className="font-display text-2xl font-bold tracking-[-.04em]">
                  {groupLabels[group]}
                </h2>
                <div className="mt-4 space-y-3">
                  {items.map(item => (
                    <div key={`${item.index}-${item.title}`} className="flex gap-3 rounded-2xl border border-[#E5EAF0] bg-[#FAFCFF] p-4">
                      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                      <div>
                        <p className="font-bold text-[#26354A]">{item.title}</p>
                        <p className="mt-1 text-sm leading-6 text-[#66758A]">{item.content}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}

            {!basics.length ? (
              <article className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
                I couldn’t find enough clear business basics to confirm yet. Nothing has been added to trusted knowledge.
              </article>
            ) : null}
          </section>

          <aside className="space-y-4">
            <div className="rounded-3xl border border-[#DCE4EE] bg-white p-5 shadow-sm">
              <ShieldCheck className="h-5 w-5 text-[#3F70D8]" />
              <h2 className="mt-4 font-bold">You stay in control</h2>
              <p className="mt-2 text-sm leading-6 text-[#66758A]">
                Website prices, finance terms, guarantees and other commercial details are not automatically treated as trusted sales facts. Add or confirm those deliberately from an authoritative source when needed.
              </p>
            </div>

            <ManagementElevation />

            {error ? (
              <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {error}
              </p>
            ) : null}

            <Button
              className="w-full"
              disabled={!basics.length || !management.data?.elevated || confirm.isPending || updateOnboarding.isPending}
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
            >
              {confirm.isPending || updateOnboarding.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Confirm and continue
            </Button>
            {!management.data?.elevated ? (
              <p className="text-center text-xs leading-5 text-[#8290A3]">
                Confirm management access above before approving shared company knowledge.
              </p>
            ) : null}
          </aside>
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

  if (setup.isLoading)
    return (
      <DashboardLayout>
        <div className="grid min-h-[55vh] place-items-center text-[#66758A]">
          <div className="flex items-center gap-3 text-sm font-semibold">
            <Loader2 className="h-5 w-5 animate-spin text-[#3F70D8]" />
            Checking your saved setup…
          </div>
        </div>
      </DashboardLayout>
    );

  if (setup.data?.currentDiscovery) return <CompanyKnowledgeReview />;
  return <Onboarding />;
}
