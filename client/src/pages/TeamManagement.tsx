import DashboardLayout from "@/components/DashboardLayout";
import ManagementElevation from "@/components/ManagementElevation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { friendlyError } from "@/lib/friendlyError";
import { trpc } from "@/lib/trpc";
import {
  CheckCircle2,
  Loader2,
  MailPlus,
  RefreshCw,
  ShieldCheck,
  UserRoundCog,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

type Member = {
  memberId: number;
  userId: number;
  name: string | null;
  email: string | null;
  role: "owner" | "manager" | "salesperson" | "auditor";
  isActive: boolean;
  hasPassword: boolean;
};
type TeamResponse = { organisation: { name: string }; members: Member[] };
type OwnerMapping = {
  id: number;
  connectedSystemId: number;
  externalUserId: string;
  displayName: string;
  email: string | null;
  userId: number | null;
  memberName: string | null;
  memberEmail: string | null;
};

async function api<T>(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok)
    throw new Error(body.error || "The team change could not be completed.");
  return body;
}

export default function TeamManagement() {
  const organisation = trpc.organisation.current.useQuery();
  const systems = trpc.connectedSystems.list.useQuery(
    { organisationId: organisation.data?.organisationId ?? 0 },
    { enabled: Boolean(organisation.data?.organisationId) }
  );
  const [team, setTeam] = useState<TeamResponse | null>(null);
  const [mappings, setMappings] = useState<OwnerMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"manager" | "salesperson" | "auditor">(
    "salesperson"
  );
  const [sending, setSending] = useState(false);
  const [mapping, setMapping] = useState({
    connectedSystemId: "",
    externalUserId: "",
    displayName: "",
    email: "",
    userId: "",
  });
  const [savingMapping, setSavingMapping] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setError("");
      const [members, ownerMappings] = await Promise.all([
        api<TeamResponse>("/api/team-admin/members"),
        api<{ mappings: OwnerMapping[] }>("/api/team-admin/crm-owner-mappings"),
      ]);
      setTeam(members);
      setMappings(ownerMappings.mappings);
    } catch (cause) {
      setError(
        friendlyError(
          cause,
          "Team administration could not be loaded. Try again."
        )
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void refresh(), [refresh]);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    try {
      setSending(true);
      setError("");
      const result = await api<{ emailState: string }>(
        "/api/team-admin/invite",
        { method: "POST", body: JSON.stringify({ name, email, role }) }
      );
      toast.success(
        result.emailState === "invite_sent"
          ? "Invitation sent."
          : "Team member added."
      );
      setName("");
      setEmail("");
      setRole("salesperson");
      await refresh();
    } catch (cause) {
      setError(
        friendlyError(
          cause,
          "That invitation could not be sent. Nothing was changed."
        )
      );
    } finally {
      setSending(false);
    }
  }

  async function updateMember(member: Member, patch: Record<string, unknown>) {
    try {
      setError("");
      await api(`/api/team-admin/members/${member.memberId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      toast.success("Member access updated.");
      await refresh();
    } catch (cause) {
      setError(
        friendlyError(
          cause,
          "That member could not be updated. Nothing was changed."
        )
      );
    }
  }

  async function saveOwnerMapping(event: React.FormEvent) {
    event.preventDefault();
    try {
      setSavingMapping(true);
      setError("");
      await api("/api/team-admin/crm-owner-mappings", {
        method: "PUT",
        body: JSON.stringify({
          connectedSystemId: Number(mapping.connectedSystemId),
          externalUserId: mapping.externalUserId,
          displayName: mapping.displayName,
          email: mapping.email || null,
          userId: mapping.userId ? Number(mapping.userId) : null,
        }),
      });
      toast.success("CRM salesperson linked.");
      setMapping(current => ({
        ...current,
        externalUserId: "",
        displayName: "",
        email: "",
        userId: "",
      }));
      await refresh();
    } catch (cause) {
      setError(
        friendlyError(
          cause,
          "That CRM salesperson could not be linked. Nothing was changed."
        )
      );
    } finally {
      setSavingMapping(false);
    }
  }

  const activeMembers = team?.members.filter(member => member.isActive) ?? [];
  return (
    <DashboardLayout>
      <div className="mx-auto max-w-6xl space-y-6 text-[#26354A]">
        <header className="rounded-3xl border border-[#DCE4EE] bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[.16em] text-[#3F70D8]">
                Team management
              </p>
              <h1 className="mt-2 font-display text-4xl font-bold tracking-[-.06em] sm:text-5xl">
                Members, roles and CRM identities.
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[#66758A]">
                Invite people, keep access current, and link each salesperson to
                the right CRM identity.
              </p>
            </div>
            <Button variant="outline" onClick={() => void refresh()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </header>
        <ManagementElevation />
        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            {error}
          </p>
        ) : null}
        <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
          <section className="rounded-3xl border border-[#DCE4EE] bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center gap-3">
              <MailPlus className="h-5 w-5 text-[#3F70D8]" />
              <h2 className="font-display text-2xl font-bold">
                Invite a member
              </h2>
            </div>
            <form className="mt-5 space-y-3" onSubmit={invite}>
              <Input
                required
                value={name}
                onChange={event => setName(event.target.value)}
                placeholder="Name"
                aria-label="Name"
              />
              <Input
                required
                type="email"
                value={email}
                onChange={event => setEmail(event.target.value)}
                placeholder="Email"
                aria-label="Email"
              />
              <select
                aria-label="Role"
                value={role}
                onChange={event => setRole(event.target.value as typeof role)}
                className="h-11 w-full rounded-xl border border-[#CCD6E2] bg-white px-3 text-sm"
              >
                <option value="salesperson">Salesperson</option>
                <option value="manager">Manager</option>
                <option value="auditor">Auditor — read only</option>
              </select>
              <Button className="w-full" disabled={sending}>
                {sending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Send invitation
              </Button>
            </form>
            <p className="mt-4 text-xs leading-5 text-[#8290A3]">
              Each person creates their own password. Managers never see or
              store it.
            </p>
          </section>
          <section className="rounded-3xl border border-[#DCE4EE] bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 text-[#3F70D8]" />
              <h2 className="font-display text-2xl font-bold">
                {team?.organisation.name || "Members"}
              </h2>
            </div>
            {loading ? (
              <p className="mt-6 text-sm text-[#66758A]">
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                Loading members…
              </p>
            ) : (
              <div className="mt-5 space-y-3">
                {team?.members.map(member => (
                  <article
                    key={member.memberId}
                    className="flex flex-col gap-3 rounded-2xl border border-[#E2E8F0] bg-[#FAFCFF] p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-bold">
                          {member.name || member.email || "Team member"}
                        </p>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${member.isActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}
                        >
                          {member.isActive ? "Active" : "Inactive"}
                        </span>
                        {member.hasPassword ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <span className="text-xs text-amber-700">
                            Invite pending
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-[#66758A]">
                        {member.email}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {member.role === "owner" ? (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-[#3F70D8]">
                          <ShieldCheck className="h-4 w-4" />
                          Owner
                        </span>
                      ) : (
                        <>
                          <select
                            aria-label={`Role for ${member.name || member.email}`}
                            value={member.role}
                            onChange={event =>
                              void updateMember(member, {
                                role: event.target.value,
                              })
                            }
                            className="h-9 rounded-lg border border-[#CCD6E2] bg-white px-2 text-xs"
                          >
                            <option value="salesperson">Salesperson</option>
                            <option value="manager">Manager</option>
                            <option value="auditor">Auditor</option>
                          </select>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void updateMember(member, {
                                isActive: !member.isActive,
                              })
                            }
                          >
                            {member.isActive ? "Deactivate" : "Reactivate"}
                          </Button>
                        </>
                      )}
                    </div>
                  </article>
                ))}
                {!team?.members.length ? (
                  <p className="text-sm text-[#66758A]">No members yet.</p>
                ) : null}
              </div>
            )}
          </section>
        </div>
        <section className="rounded-3xl border border-[#DCE4EE] bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-center gap-3">
            <UserRoundCog className="h-5 w-5 text-[#3F70D8]" />
            <div>
              <h2 className="font-display text-2xl font-bold">
                CRM salesperson links
              </h2>
              <p className="mt-1 text-sm text-[#66758A]">
                Link CRM work to the right AmarktAI member. Uncertain matches
                stay unlinked.
              </p>
            </div>
          </div>
          <form
            onSubmit={saveOwnerMapping}
            className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-3"
          >
            <select
              required
              aria-label="CRM"
              value={mapping.connectedSystemId}
              onChange={event =>
                setMapping({
                  ...mapping,
                  connectedSystemId: event.target.value,
                })
              }
              className="h-11 rounded-xl border border-[#CCD6E2] bg-white px-3 text-sm"
            >
              <option value="">Choose CRM</option>
              {systems.data?.map(system => (
                <option key={system.id} value={system.id}>
                  {system.displayName}
                </option>
              ))}
            </select>
            <Input
              required
              value={mapping.externalUserId}
              onChange={event =>
                setMapping({ ...mapping, externalUserId: event.target.value })
              }
              placeholder="CRM salesperson reference"
              aria-label="CRM salesperson reference"
            />
            <Input
              required
              value={mapping.displayName}
              onChange={event =>
                setMapping({ ...mapping, displayName: event.target.value })
              }
              placeholder="Name shown in CRM"
              aria-label="CRM salesperson name"
            />
            <Input
              type="email"
              value={mapping.email}
              onChange={event =>
                setMapping({ ...mapping, email: event.target.value })
              }
              placeholder="CRM email (optional)"
              aria-label="CRM salesperson email"
            />
            <select
              aria-label="AmarktAI member"
              value={mapping.userId}
              onChange={event =>
                setMapping({ ...mapping, userId: event.target.value })
              }
              className="h-11 rounded-xl border border-[#CCD6E2] bg-white px-3 text-sm"
            >
              <option value="">Leave unlinked</option>
              {activeMembers.map(member => (
                <option key={member.userId} value={member.userId}>
                  {member.name || member.email}
                </option>
              ))}
            </select>
            <Button disabled={savingMapping || !systems.data?.length}>
              {savingMapping ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Save link
            </Button>
          </form>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {mappings.map(item => (
              <article
                key={item.id}
                className="rounded-2xl border border-[#E2E8F0] bg-[#FAFCFF] p-4"
              >
                <p className="font-bold">{item.displayName}</p>
                <p className="mt-1 text-xs text-[#66758A]">
                  {item.email || "No CRM email"}
                </p>
                <p className="mt-3 text-sm">
                  {item.memberName || item.memberEmail || "Not linked yet"}
                </p>
              </article>
            ))}
            {!mappings.length ? (
              <p className="text-sm text-[#66758A]">
                No CRM salesperson links yet.
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}
