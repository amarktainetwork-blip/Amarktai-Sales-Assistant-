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
import { BadgeCheck, Check, Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import Onboarding from "./Onboarding";
import Knowledge from "./Knowledge";

const groupLabels = {
  company: "Your business",
  offerings: "What you offer",
  credentials: "Credentials",
  contact: "Contact and support",
} as const;

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

  const discovery = setup.data?.currentDiscovery ?? null;
  const candidates = (discovery?.proposedKnowledge ??
    []) as WebsiteKnowledgeApprovalCandidate[];
  const basics = useMemo(
    () => buildBusinessBasicsApproval(candidates),
    [candidates]
  );
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

  useEffect(() => {
    setCorrections(current => {
      const next = { ...current };
      for (const item of basics)
        next[item.index] ??= { title: item.title, content: item.content };
      return next;
    });
  }, [basics]);

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
      <div className="mx-auto max-w-5xl text-[#26354A]">
        <header className="rounded-2xl border border-[#DCE4EE] bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start gap-4">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
              <BadgeCheck className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[.14em] text-emerald-700">
                Business review
              </p>
              <h1 className="mt-1 text-3xl font-bold tracking-[-.04em]">
                Check what Amarktai learned.
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[#66758A]">
                Correct anything that is wrong, then confirm the business facts
                your sales team can trust.
              </p>
              {discovery.sourceUrl ? (
                <a
                  className="mt-2 inline-block text-xs font-semibold text-[#3F70D8] hover:underline"
                  href={discovery.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  View website source
                </a>
              ) : null}
            </div>
          </div>
        </header>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_300px]">
          <section className="space-y-4">
            {groups.map(({ group, items }) => (
              <article
                key={group}
                className="rounded-2xl border border-[#DCE4EE] bg-white p-5 shadow-sm"
              >
                <h2 className="text-xl font-bold">{groupLabels[group]}</h2>
                <div className="mt-4 space-y-3">
                  {items.map(item => (
                    <div
                      key={`${item.index}-${item.title}`}
                      className="flex gap-3 rounded-xl border border-[#E5EAF0] bg-[#FAFCFF] p-4"
                    >
                      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <Input
                          aria-label={`Title for ${item.title}`}
                          value={corrections[item.index]?.title ?? item.title}
                          onChange={event =>
                            setCorrections(current => ({
                              ...current,
                              [item.index]: {
                                title: event.target.value,
                                content:
                                  current[item.index]?.content ?? item.content,
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
                    </div>
                  ))}
                </div>
              </article>
            ))}

            {!basics.length ? (
              <article className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950">
                I couldn’t find enough clear business basics to confirm yet.
                Nothing has been added to trusted knowledge.
              </article>
            ) : null}
          </section>

          <aside className="space-y-4">
            <div className="rounded-2xl border border-[#DCE4EE] bg-white p-5 shadow-sm">
              <ShieldCheck className="h-5 w-5 text-[#3F70D8]" />
              <h2 className="mt-3 font-bold">You stay in control</h2>
              <p className="mt-2 text-sm leading-6 text-[#66758A]">
                Commercial details such as prices, finance terms and guarantees
                are only trusted when you deliberately confirm them.
              </p>
            </div>

            <ManagementElevation />

            {error ? (
              <p
                role="alert"
                className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-900"
              >
                {error}
              </p>
            ) : null}

            <Button
              className="w-full"
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
                  corrections: basics.map(item => ({
                    index: item.index,
                    ...(corrections[item.index] ?? {
                      title: item.title,
                      content: item.content,
                    }),
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
              <p className="text-center text-xs leading-5 text-[#66758A]">
                Confirm management access above before approving shared company
                knowledge.
              </p>
            ) : null}
          </aside>
        </div>
      </div>
    </DashboardLayout>
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

  // The durable onboarding flag is progress metadata, not proof that setup
  // still exists. A reset or repair can legitimately remove the company
  // profile while leaving organisation settings intact. In that case the real
  // first-run flow must always win over the stale completion flag.
  if (!setup.data?.profile) return <Onboarding />;
  if (setup.data.currentDiscovery) return <CompanyKnowledgeReview />;

  const onboarding = organisation.data?.settings?.onboarding;
  const markedComplete = Boolean(
    onboarding &&
      typeof onboarding === "object" &&
      !Array.isArray(onboarding) &&
      (onboarding as { complete?: unknown }).complete === true
  );
  if (
    markedComplete &&
    setup.data.profile.discoveryStatus === "confirmed"
  )
    return <Knowledge />;

  return <Onboarding />;
}
