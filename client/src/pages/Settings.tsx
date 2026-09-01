import DashboardLayout from "@/components/DashboardLayout";
import ManagementElevation from "@/components/ManagementElevation";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import {
  BookOpenCheck,
  Building2,
  Cable,
  ChevronRight,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useLocation } from "wouter";

export default function Settings() {
  const [, navigate] = useLocation();
  const organisation = trpc.organisation.current.useQuery(undefined, {
    retry: false,
  });
  const company = trpc.companySetup.get.useQuery(undefined, { retry: false });
  const organisationId = organisation.data?.organisationId;
  const systems = trpc.connectedSystems.list.useQuery(
    { organisationId: organisationId ?? 0 },
    { enabled: Boolean(organisationId), retry: false }
  );

  const profile = company.data?.profile;
  const crmCount = systems.data?.length ?? 0;
  const workspaceMode = organisation.data?.settings?.workspaceMode;

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-5xl space-y-5 text-[#26354A]">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.12em] text-[#6B7A90]">
            Workspace
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-[-.04em]">Settings</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#66758A]">
            Company setup, CRM connection, trusted knowledge and team access are
            managed here. Daily sales work stays out of the settings area.
          </p>
        </div>

        <ManagementElevation />

        <section className="grid gap-4 md:grid-cols-2">
          <SettingCard
            icon={Building2}
            title="Company setup"
            detail={
              profile
                ? `${profile.companyName} · ${profile.discoveryStatus === "confirmed" ? "business knowledge confirmed" : "setup still in progress"}`
                : "Start or continue the guided company onboarding."
            }
            action="Open company setup"
            onClick={() => navigate("/company-setup")}
          />
          <SettingCard
            icon={Cable}
            title="CRM connection"
            detail={
              crmCount
                ? `${crmCount} CRM connection${crmCount === 1 ? "" : "s"} configured. Open this area to sign in, reconnect or review status.`
                : "Connect the company CRM and complete the secure sign-in."
            }
            action={crmCount ? "Manage CRM" : "Connect CRM"}
            onClick={() => navigate("/connections")}
          />
          <SettingCard
            icon={BookOpenCheck}
            title="Company knowledge"
            detail="Review the trusted business facts Amarktai uses when helping the sales team."
            action="Review knowledge"
            onClick={() => navigate("/knowledge")}
          />
          {workspaceMode === "team" ? (
            <SettingCard
              icon={Users}
              title="Team members"
              detail="Invite, link and manage the people who use this sales workspace."
              action="Manage team members"
              onClick={() => navigate("/team/manage")}
            />
          ) : (
            <SettingCard
              icon={ShieldCheck}
              title="Security"
              detail="Sensitive company and CRM changes require a short management-access confirmation."
              action="Security is active"
            />
          )}
        </section>
      </div>
    </DashboardLayout>
  );
}

function SettingCard({
  icon: Icon,
  title,
  detail,
  action,
  onClick,
}: {
  icon: typeof Building2;
  title: string;
  detail: string;
  action: string;
  onClick?: () => void;
}) {
  return (
    <article className="flex min-h-48 flex-col rounded-2xl border border-[#DCE4EE] bg-white p-5 shadow-sm">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#EEF3F8] text-[#405B7A]">
        <Icon className="h-5 w-5" />
      </span>
      <h2 className="mt-4 text-lg font-bold">{title}</h2>
      <p className="mt-2 flex-1 text-sm leading-6 text-[#66758A]">{detail}</p>
      {onClick ? (
        <Button
          variant="outline"
          className="mt-4 justify-between"
          onClick={onClick}
        >
          {action}
          <ChevronRight className="h-4 w-4" />
        </Button>
      ) : (
        <p className="mt-4 text-xs font-bold text-emerald-700">{action}</p>
      )}
    </article>
  );
}
