import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useEffect } from "react";
import CompanySetup from "./CompanySetup";

/**
 * Keeps the visible four-step company setup aligned with the persisted legacy
 * onboarding step numbering. A confirmed company review must resume at the CRM
 * step, never fall back to website learning after refresh.
 */
export default function CompanySetupProgressGate() {
  const utils = trpc.useUtils();
  const setup = trpc.companySetup.get.useQuery(undefined, { retry: false });
  const organisation = trpc.organisation.current.useQuery(undefined, {
    retry: false,
  });
  const updateOnboarding = trpc.organisation.updateOnboarding.useMutation({
    onSuccess: async () => {
      await utils.organisation.current.invalidate();
    },
  });

  const confirmed = setup.data?.profile?.discoveryStatus === "confirmed";
  const onboarding = organisation.data?.settings?.onboarding as
    | { step?: unknown }
    | undefined;
  const savedStep = Number(onboarding?.step ?? 0);
  const needsCrmProgressRepair =
    confirmed && (!Number.isFinite(savedStep) || savedStep < 4);

  useEffect(() => {
    if (!needsCrmProgressRepair || updateOnboarding.isPending) return;
    updateOnboarding.mutate({ step: 4 });
  }, [needsCrmProgressRepair, updateOnboarding.isPending]);

  if (
    setup.isLoading ||
    organisation.isLoading ||
    needsCrmProgressRepair ||
    updateOnboarding.isPending
  ) {
    return (
      <DashboardLayout>
        <div className="mx-auto max-w-3xl text-[#EEF5FF]">
          <section className="rounded-[1.75rem] border border-white/10 bg-[#0C1E3E] p-6 sm:p-8">
            <p className="text-sm font-bold text-white">Opening the next setup step…</p>
            <p className="mt-2 text-xs leading-5 text-[#91A9CF]">
              Your confirmed business knowledge is preserved. Amarktai is aligning the saved setup position with CRM commissioning.
            </p>
          </section>
        </div>
      </DashboardLayout>
    );
  }

  return <CompanySetup />;
}
