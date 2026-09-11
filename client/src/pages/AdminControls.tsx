import DashboardLayout from "@/components/DashboardLayout";
import ManagementElevation from "@/components/ManagementElevation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  BadgeDollarSign,
  Bot,
  Loader2,
  Save,
  ShieldCheck,
  Target,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type Policy = {
  mode: "advise" | "review" | "auto_preapproved";
  preset?: "assist_only" | "balanced" | "automated";
  autoActionTypes: string[];
  actionModes?: Record<
    string,
    "automatic" | "salesperson_approval" | "manager_approval" | "disabled"
  >;
  monitorKeys?: string[];
  triggerKeys?: string[];
  scope?: {
    userIds: number[];
    pipelineIds: string[];
    leadSources: string[];
  };
  conditions?: Record<string, string[]>;
  schedule?: {
    mode: "continuous" | "business_hours" | "daily" | "manual";
    timezone?: string;
    days: number[];
    startHour?: number;
    endHour?: number;
  };
  safety?: {
    maximumActionsPerRun: number;
    deduplicationWindowMinutes: number;
    maximumRetries: number;
    quietHoursEnabled: boolean;
    allowedActionKeys: string[];
    allowedChannels: Array<"email" | "sms" | "whatsapp" | "dialler">;
    allowedTemplateIds: string[];
  };
  requireReviewForCommunications?: boolean;
  requireReviewForStageChanges?: boolean;
};
type Capabilities = { policy: Policy; actionTypes: string[] };
type Wallet = {
  balance: number;
  used: number;
  purchased: number;
  plan: { key: string; name: string; includedAiCredits: number };
  entries: Array<{
    id: number;
    creditsDelta: number;
    transactionType: string;
    feature?: string;
    occurredAt: string;
  }>;
};
type Member = {
  userId: number;
  name: string | null;
  email: string | null;
  role: string;
  isActive: boolean;
};
type TargetRow = {
  userId: number;
  dailyActivityTarget: number;
  monthlyWonValueTargetMinor: number;
  maxOverdueTasks: number;
};

const autoOptions = [
  ["append_contact_note", "Add factual CRM notes"],
  ["schedule_callback", "Create callbacks/tasks"],
  ["complete_active_task", "Complete known tasks"],
  ["create_activity", "Log CRM activities"],
  ["update_contact", "Update contact fields"],
  ["update_opportunity", "Update opportunity fields"],
  ["send_email", "Send email"],
  ["send_sms", "Send SMS"],
  ["send_whatsapp", "Send WhatsApp"],
] as const;

const monitorOptions = [
  ["new_leads", "New leads"],
  ["task_changes", "Task changes"],
  ["opportunities", "Opportunities"],
  ["inbound_mail", "Inbound mail"],
  ["callbacks", "Callbacks"],
  ["appointments", "Appointments"],
  ["stale_leads", "Stale leads"],
  ["overdue_tasks", "Overdue tasks"],
] as const;
const triggerOptions = [
  ["new_lead", "New lead"],
  ["field_or_stage_change", "CRM field/stage change"],
  ["inbound_email", "Inbound email"],
  ["scheduled_time", "Scheduled time"],
  ["overdue_task", "Overdue task"],
  ["callback_due", "Callback due"],
  ["opportunity_stalled", "Opportunity stalled"],
  ["explicit_user_action", "User action"],
] as const;
const weekdayOptions = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.error || `Request failed with ${response.status}`);
  return body as T;
}

export default function AdminControls() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [targets, setTargets] = useState<TargetRow[]>([]);
  const [currency, setCurrency] = useState("USD");
  const [workflowConfigText, setWorkflowConfigText] = useState("");
  const [workflowConfigLoaded, setWorkflowConfigLoaded] = useState(false);
  const [workflowConfigStatus, setWorkflowConfigStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [capabilityData, creditData, memberData, targetData] =
        await Promise.all([
          request<Capabilities>("/api/sales-automation/capabilities"),
          request<Wallet>("/api/ai-credits"),
          request<{ members: Member[] }>("/api/team-admin/members"),
          request<{ targets: TargetRow[]; currency: string }>(
            "/api/sales-targets"
          ),
        ]);
      setPolicy(capabilityData.policy);
      setWallet(creditData);
      setMembers(memberData.members);
      setTargets(targetData.targets);
      setCurrency(targetData.currency);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Management controls could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  function row(userId: number) {
    return (
      targets.find(target => target.userId === userId) || {
        userId,
        dailyActivityTarget: 0,
        monthlyWonValueTargetMinor: 0,
        maxOverdueTasks: 0,
      }
    );
  }
  function updateTarget(userId: number, patch: Partial<TargetRow>) {
    setTargets(current => {
      const exists = current.some(target => target.userId === userId);
      return exists
        ? current.map(target =>
            target.userId === userId ? { ...target, ...patch } : target
          )
        : [...current, { ...row(userId), ...patch }];
    });
  }
  function applyPreset(preset: NonNullable<Policy["preset"]>) {
    if (!policy) return;
    const automatic =
      preset === "balanced"
        ? ["schedule_callback"]
        : preset === "automated"
          ? [
              "append_contact_note",
              "schedule_callback",
              "complete_active_task",
              "create_activity",
            ]
          : [];
    setPolicy({
      ...policy,
      preset,
      mode: preset === "assist_only" ? "review" : "auto_preapproved",
      autoActionTypes: automatic,
      actionModes: Object.fromEntries(
        autoOptions.map(([key]) => [
          key,
          automatic.includes(key)
            ? "automatic"
            : ["send_sms", "send_whatsapp", "update_opportunity"].includes(key)
              ? "manager_approval"
              : "salesperson_approval",
        ])
      ) as Policy["actionModes"],
      requireReviewForCommunications: true,
      requireReviewForStageChanges: true,
    });
  }
  function setActionMode(
    actionType: string,
    mode: NonNullable<Policy["actionModes"]>[string]
  ) {
    if (!policy) return;
    setPolicy({
      ...policy,
      actionModes: { ...(policy.actionModes || {}), [actionType]: mode },
      autoActionTypes:
        mode === "automatic"
          ? Array.from(new Set([...policy.autoActionTypes, actionType]))
          : policy.autoActionTypes.filter(value => value !== actionType),
    });
  }
  function togglePolicyList(
    values: string[] | undefined,
    value: string,
    update: (next: string[]) => void
  ) {
    const current = values || [];
    update(
      current.includes(value)
        ? current.filter(item => item !== value)
        : [...current, value]
    );
  }
  function commaValues(value: string) {
    return Array.from(
      new Set(
        value
          .split(",")
          .map(item => item.trim())
          .filter(Boolean)
      )
    );
  }

  async function savePolicy() {
    if (!policy) return;
    try {
      setSaving("policy");
      const result = await request<{ policy: Policy }>(
        "/api/sales-automation/policy",
        { method: "PUT", body: JSON.stringify(policy) }
      );
      setPolicy(result.policy);
      toast.success("Automation policy saved.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Policy could not be saved."
      );
    } finally {
      setSaving(null);
    }
  }
  async function saveTargets() {
    try {
      setSaving("targets");
      const result = await request<{ targets: TargetRow[] }>(
        "/api/sales-targets",
        { method: "PUT", body: JSON.stringify({ targets }) }
      );
      setTargets(result.targets);
      toast.success("Sales targets saved.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Targets could not be saved."
      );
    } finally {
      setSaving(null);
    }
  }

  async function loadWorkflowConfiguration() {
    try {
      setSaving("workflow-load");
      const result = await request<{
        configuration: Record<string, unknown>;
        validation: { valid: boolean; workflowKeys?: string[]; error?: string };
      }>("/api/client-workflow-configuration");
      setWorkflowConfigText(JSON.stringify(result.configuration, null, 2));
      setWorkflowConfigLoaded(true);
      setWorkflowConfigStatus(
        result.validation.valid
          ? `Validated · ${result.validation.workflowKeys?.length || 0} workflow${result.validation.workflowKeys?.length === 1 ? "" : "s"}`
          : result.validation.error || "Configuration needs attention."
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Client workflow rules could not be loaded."
      );
    } finally {
      setSaving(null);
    }
  }

  async function saveWorkflowConfiguration() {
    try {
      setSaving("workflow-config");
      const configuration = JSON.parse(workflowConfigText) as Record<
        string,
        unknown
      >;
      const result = await request<{
        configuration: Record<string, unknown>;
        validation: { valid: true; workflowKeys: string[]; templateKeys: string[] };
      }>("/api/client-workflow-configuration", {
        method: "PUT",
        body: JSON.stringify({ configuration }),
      });
      setWorkflowConfigText(JSON.stringify(result.configuration, null, 2));
      setWorkflowConfigLoaded(true);
      setWorkflowConfigStatus(
        `Validated and saved · ${result.validation.workflowKeys.length} workflow${result.validation.workflowKeys.length === 1 ? "" : "s"} · ${result.validation.templateKeys.length} template${result.validation.templateKeys.length === 1 ? "" : "s"}`
      );
      toast.success("Client workflow rules validated and saved.");
    } catch (error) {
      toast.error(
        error instanceof SyntaxError
          ? "Client workflow rules must be valid JSON."
          : error instanceof Error
            ? error.message
            : "Client workflow rules could not be saved."
      );
    } finally {
      setSaving(null);
    }
  }

  async function copyWorkflowConfiguration() {
    if (!workflowConfigText) return;
    try {
      await navigator.clipboard.writeText(workflowConfigText);
      toast.success("Client workflow configuration copied.");
    } catch {
      toast.error("Copy failed. Select the configuration text manually.");
    }
  }

  if (loading)
    return (
      <DashboardLayout>
        <div className="grid min-h-[60vh] place-items-center">
          <Loader2 className="size-7 animate-spin text-[#8CB7FF]" />
        </div>
      </DashboardLayout>
    );
  return (
    <DashboardLayout>
      <div className="mx-auto max-w-[1500px] space-y-6">
        <ManagementElevation />
        <header className="border-b border-white/10 pb-7">
          <p className="text-[10px] font-black uppercase tracking-[.16em] text-[#83AEFF]">
            MANAGEMENT CONTROLS
          </p>
          <h1 className="mt-2 font-display text-5xl font-bold tracking-[-.07em] text-white">
            Decide what Amarktai may do automatically.
          </h1>
          <p className="mt-3 max-w-4xl text-sm leading-6 text-[#A9BFDF]">
            Set the automation boundary, salesperson targets and AI budget. CRM
            monitoring, task arithmetic and management exceptions remain
            deterministic and do not consume AI Credits.
          </p>
        </header>

        <section className="grid gap-5 xl:grid-cols-[1.05fr_.95fr]">
          <article className="rounded-[1.75rem] border border-white/10 bg-[#0E2142] p-6">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-xl bg-[#153B7A] text-[#9FC2FF]">
                <ShieldCheck size={20} />
              </span>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[.13em] text-[#7FAAF8]">
                  AUTOMATION POLICY
                </p>
                <h2 className="font-display text-3xl font-bold text-white">
                  Human control where it matters.
                </h2>
              </div>
            </div>
            <div className="mt-5 grid gap-2 sm:grid-cols-3">
              {(
                [
                  [
                    "assist_only",
                    "Assist only",
                    "Monitor and propose. You approve external actions.",
                  ],
                  [
                    "balanced",
                    "Balanced",
                    "Safe reminders run; communications stay in review.",
                  ],
                  [
                    "automated",
                    "Automated",
                    "Approved deterministic categories run automatically.",
                  ],
                ] as const
              ).map(([value, title, detail]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => applyPreset(value)}
                  className={`rounded-xl border p-3 text-left ${policy?.preset === value ? "border-[#6EA3FF] bg-[#153B7A]" : "border-white/10 bg-[#08172F]"}`}
                >
                  <span className="block text-sm font-bold text-white">
                    {title}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-[#9DB3D5]">
                    {detail}
                  </span>
                </button>
              ))}
            </div>
            <label className="mt-5 grid gap-2">
              <span className="text-xs font-bold text-[#A9BFDF]">
                Operating mode
              </span>
              <select
                value={policy?.mode || "review"}
                onChange={e =>
                  policy &&
                  setPolicy({
                    ...policy,
                    mode: e.target.value as Policy["mode"],
                  })
                }
                className="h-12 rounded-xl border border-white/15 bg-[#08172F] px-3 text-white"
              >
                <option value="advise">Advise only</option>
                <option value="review">Review before execution</option>
                <option value="auto_preapproved">
                  Auto-execute pre-approved actions
                </option>
              </select>
            </label>
            <div className="mt-5">
              <p className="text-xs font-bold text-[#A9BFDF]">
                Approval mode for each action
              </p>
              <div className="mt-3 grid gap-2">
                {autoOptions.map(([value, label]) => (
                  <label
                    key={value}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#08172F] p-3 text-sm text-[#C5D6EF]"
                  >
                    <span>{label}</span>
                    <select
                      aria-label={`${label} approval mode`}
                      value={
                        policy?.actionModes?.[value] ||
                        (policy?.autoActionTypes.includes(value)
                          ? "automatic"
                          : "salesperson_approval")
                      }
                      onChange={event =>
                        setActionMode(
                          value,
                          event.target.value as NonNullable<
                            Policy["actionModes"]
                          >[string]
                        )
                      }
                      className="rounded-lg border border-white/15 bg-[#0E2142] px-2 py-1 text-xs text-white"
                    >
                      <option value="automatic">Automatic</option>
                      <option value="salesperson_approval">
                        Salesperson approval
                      </option>
                      <option value="manager_approval">Manager approval</option>
                      <option value="disabled">Disabled</option>
                    </select>
                  </label>
                ))}
              </div>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <PolicyChecks
                title="Monitor"
                options={monitorOptions}
                selected={policy?.monitorKeys || []}
                onToggle={value =>
                  policy &&
                  togglePolicyList(policy.monitorKeys, value, monitorKeys =>
                    setPolicy({ ...policy, monitorKeys })
                  )
                }
              />
              <PolicyChecks
                title="Start work when"
                options={triggerOptions}
                selected={policy?.triggerKeys || []}
                onToggle={value =>
                  policy &&
                  togglePolicyList(policy.triggerKeys, value, triggerKeys =>
                    setPolicy({ ...policy, triggerKeys })
                  )
                }
              />
            </div>
            <div className="mt-5">
              <p className="text-xs font-bold text-[#A9BFDF]">
                Salesperson scope
              </p>
              <p className="mt-1 text-xs text-[#829CC4]">
                No selection means every salesperson in this organisation.
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {members
                  .filter(member => member.isActive)
                  .map(member => (
                    <label
                      key={member.userId}
                      className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#08172F] p-2 text-xs text-[#C5D6EF]"
                    >
                      <input
                        type="checkbox"
                        checked={(policy?.scope?.userIds || []).includes(
                          member.userId
                        )}
                        onChange={() => {
                          if (!policy) return;
                          const values = policy.scope?.userIds || [];
                          const userIds = values.includes(member.userId)
                            ? values.filter(id => id !== member.userId)
                            : [...values, member.userId];
                          setPolicy({
                            ...policy,
                            scope: {
                              userIds,
                              pipelineIds: policy.scope?.pipelineIds || [],
                              leadSources: policy.scope?.leadSources || [],
                            },
                          });
                        }}
                      />
                      {member.name || member.email || `User ${member.userId}`}
                    </label>
                  ))}
              </div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <PolicyText
                label="CRM pipeline IDs"
                value={(policy?.scope?.pipelineIds || []).join(", ")}
                placeholder="sales, renewals"
                onChange={value =>
                  policy &&
                  setPolicy({
                    ...policy,
                    scope: {
                      userIds: policy.scope?.userIds || [],
                      pipelineIds: commaValues(value),
                      leadSources: policy.scope?.leadSources || [],
                    },
                  })
                }
              />
              <PolicyText
                label="Lead sources"
                value={(policy?.scope?.leadSources || []).join(", ")}
                placeholder="website, referral"
                onChange={value =>
                  policy &&
                  setPolicy({
                    ...policy,
                    scope: {
                      userIds: policy.scope?.userIds || [],
                      pipelineIds: policy.scope?.pipelineIds || [],
                      leadSources: commaValues(value),
                    },
                  })
                }
              />
              <PolicyText
                label="Allowed CRM stages"
                value={(policy?.conditions?.stage || []).join(", ")}
                placeholder="qualified, proposal"
                onChange={value =>
                  policy &&
                  setPolicy({
                    ...policy,
                    conditions: {
                      ...(policy.conditions || {}),
                      stage: commaValues(value),
                    },
                  })
                }
              />
              <PolicyText
                label="Allowed inbound categories"
                value={(policy?.conditions?.category || []).join(", ")}
                placeholder="reply, meeting_request"
                onChange={value =>
                  policy &&
                  setPolicy({
                    ...policy,
                    conditions: {
                      ...(policy.conditions || {}),
                      category: commaValues(value),
                    },
                  })
                }
              />
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-bold text-[#A9BFDF]">
                Maximum actions per run
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={policy?.safety?.maximumActionsPerRun || 25}
                  onChange={event =>
                    policy &&
                    setPolicy({
                      ...policy,
                      safety: {
                        ...(policy.safety || {
                          maximumActionsPerRun: 25,
                          deduplicationWindowMinutes: 1440,
                          maximumRetries: 2,
                          quietHoursEnabled: true,
                          allowedActionKeys: [],
                          allowedChannels: [],
                          allowedTemplateIds: [],
                        }),
                        maximumActionsPerRun: Number(event.target.value),
                      },
                    })
                  }
                  className="mt-2 border-white/15 bg-[#08172F] text-white"
                />
              </label>
              <label className="text-xs font-bold text-[#A9BFDF]">
                Schedule
                <select
                  value={policy?.schedule?.mode || "continuous"}
                  onChange={event =>
                    policy &&
                    setPolicy({
                      ...policy,
                      schedule: {
                        ...(policy.schedule || {
                          mode: "continuous",
                          days: [1, 2, 3, 4, 5],
                        }),
                        mode: event.target.value as NonNullable<
                          Policy["schedule"]
                        >["mode"],
                      },
                    })
                  }
                  className="mt-2 h-10 w-full rounded-lg border border-white/15 bg-[#08172F] px-2 text-white"
                >
                  <option value="continuous">Continuous</option>
                  <option value="business_hours">Business hours</option>
                  <option value="daily">Daily</option>
                  <option value="manual">Manual only</option>
                </select>
              </label>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <PolicyText
                label="Schedule time zone"
                value={policy?.schedule?.timezone || "Africa/Johannesburg"}
                placeholder="Africa/Johannesburg"
                onChange={timezone =>
                  policy &&
                  setPolicy({
                    ...policy,
                    schedule: {
                      ...(policy.schedule || {
                        mode: "continuous",
                        days: [1, 2, 3, 4, 5],
                      }),
                      timezone,
                    },
                  })
                }
              />
              <PolicyNumber
                label="Starts at hour"
                min={0}
                max={23}
                value={policy?.schedule?.startHour ?? 8}
                onChange={startHour =>
                  policy &&
                  setPolicy({
                    ...policy,
                    schedule: {
                      ...(policy.schedule || {
                        mode: "continuous",
                        days: [1, 2, 3, 4, 5],
                      }),
                      startHour,
                    },
                  })
                }
              />
              <PolicyNumber
                label="Ends before hour"
                min={1}
                max={24}
                value={policy?.schedule?.endHour ?? 17}
                onChange={endHour =>
                  policy &&
                  setPolicy({
                    ...policy,
                    schedule: {
                      ...(policy.schedule || {
                        mode: "continuous",
                        days: [1, 2, 3, 4, 5],
                      }),
                      endHour,
                    },
                  })
                }
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {weekdayOptions.map((day, index) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => {
                    if (!policy) return;
                    const days = policy.schedule?.days || [];
                    setPolicy({
                      ...policy,
                      schedule: {
                        ...(policy.schedule || {
                          mode: "continuous",
                          days: [],
                        }),
                        days: days.includes(index)
                          ? days.filter(value => value !== index)
                          : [...days, index].sort(),
                      },
                    });
                  }}
                  className={`rounded-lg border px-3 py-2 text-xs font-bold ${(policy?.schedule?.days || []).includes(index) ? "border-[#6EA3FF] bg-[#153B7A] text-white" : "border-white/10 bg-[#08172F] text-[#829CC4]"}`}
                >
                  {day}
                </button>
              ))}
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <PolicyNumber
                label="Deduplication window (minutes)"
                min={1}
                max={43_200}
                value={policy?.safety?.deduplicationWindowMinutes || 1440}
                onChange={deduplicationWindowMinutes =>
                  policy?.safety &&
                  setPolicy({
                    ...policy,
                    safety: {
                      ...policy.safety,
                      deduplicationWindowMinutes,
                    },
                  })
                }
              />
              <PolicyNumber
                label="Maximum retries"
                min={0}
                max={10}
                value={policy?.safety?.maximumRetries ?? 2}
                onChange={maximumRetries =>
                  policy?.safety &&
                  setPolicy({
                    ...policy,
                    safety: { ...policy.safety, maximumRetries },
                  })
                }
              />
              <PolicyText
                label="Allowed template IDs"
                value={(policy?.safety?.allowedTemplateIds || []).join(", ")}
                placeholder="followup-v2, renewal"
                onChange={value =>
                  policy?.safety &&
                  setPolicy({
                    ...policy,
                    safety: {
                      ...policy.safety,
                      allowedTemplateIds: commaValues(value),
                    },
                  })
                }
              />
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <PolicyChecks
                title="Allowed action keys"
                options={autoOptions}
                selected={policy?.safety?.allowedActionKeys || []}
                emptyMeansAll
                onToggle={value =>
                  policy?.safety &&
                  togglePolicyList(
                    policy.safety.allowedActionKeys,
                    value,
                    allowedActionKeys =>
                      setPolicy({
                        ...policy,
                        safety: { ...policy.safety!, allowedActionKeys },
                      })
                  )
                }
              />
              <PolicyChecks
                title="Allowed channels"
                options={[
                  ["email", "Email"],
                  ["sms", "SMS"],
                  ["whatsapp", "WhatsApp"],
                  ["dialler", "Dialler"],
                ]}
                selected={policy?.safety?.allowedChannels || []}
                emptyMeansAll
                onToggle={value =>
                  policy?.safety &&
                  togglePolicyList(
                    policy.safety.allowedChannels,
                    value,
                    allowedChannels =>
                      setPolicy({
                        ...policy,
                        safety: {
                          ...policy.safety!,
                          allowedChannels: allowedChannels as NonNullable<
                            Policy["safety"]
                          >["allowedChannels"],
                        },
                      })
                  )
                }
              />
            </div>
            <div className="mt-5 space-y-2">
              <label className="flex items-center gap-3 text-sm text-[#C5D6EF]">
                <input
                  type="checkbox"
                  checked={policy?.safety?.quietHoursEnabled !== false}
                  onChange={event =>
                    policy?.safety &&
                    setPolicy({
                      ...policy,
                      safety: {
                        ...policy.safety,
                        quietHoursEnabled: event.target.checked,
                      },
                    })
                  }
                />
                Pause unattended automation during quiet hours
              </label>
              <label className="flex items-center gap-3 text-sm text-[#C5D6EF]">
                <input
                  type="checkbox"
                  checked={policy?.requireReviewForCommunications !== false}
                  onChange={e =>
                    policy &&
                    setPolicy({
                      ...policy,
                      requireReviewForCommunications: e.target.checked,
                    })
                  }
                />
                Always review outbound customer communications
              </label>
              <label className="flex items-center gap-3 text-sm text-[#C5D6EF]">
                <input
                  type="checkbox"
                  checked={policy?.requireReviewForStageChanges !== false}
                  onChange={e =>
                    policy &&
                    setPolicy({
                      ...policy,
                      requireReviewForStageChanges: e.target.checked,
                    })
                  }
                />
                Always review pipeline/status changes
              </label>
            </div>
            <Button
              onClick={savePolicy}
              disabled={saving === "policy"}
              className="mt-6 bg-[#1B64F2] hover:bg-[#2B76FF]"
            >
              <Save className="mr-2 size-4" />
              {saving === "policy" ? "Saving…" : "Save automation policy"}
            </Button>
          </article>

          <article className="rounded-[1.75rem] border border-white/10 bg-[#0E2142] p-6">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-xl bg-[#153B7A] text-[#9FC2FF]">
                <BadgeDollarSign size={20} />
              </span>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[.13em] text-[#7FAAF8]">
                  AI CREDIT POOL
                </p>
                <h2 className="font-display text-3xl font-bold text-white">
                  {wallet?.balance ?? 0} credits available
                </h2>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-3">
              <Metric label="Plan" value={wallet?.plan.name || "Trial"} />
              <Metric label="Used" value={wallet?.used || 0} />
              <Metric label="Purchased" value={wallet?.purchased || 0} />
            </div>
            <p className="mt-5 rounded-xl bg-[#08172F] p-4 text-sm leading-6 text-[#A9BFDF]">
              Included allowance:{" "}
              <strong className="text-white">
                {wallet?.plan.includedAiCredits || 0}
              </strong>{" "}
              per plan period. AI Credits are reserved for language/reasoning
              work; CRM sync, rules, management thresholds and deterministic
              actions remain zero-credit operations.
            </p>
            <div className="mt-5 max-h-56 space-y-2 overflow-auto">
              {wallet?.entries.slice(0, 8).map(entry => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between rounded-xl border border-white/8 px-3 py-2 text-xs"
                >
                  <span className="text-[#9DB3D5]">
                    {entry.feature || entry.transactionType}
                  </span>
                  <span
                    className={
                      entry.creditsDelta >= 0
                        ? "font-bold text-emerald-300"
                        : "font-bold text-amber-200"
                    }
                  >
                    {entry.creditsDelta >= 0 ? "+" : ""}
                    {entry.creditsDelta}
                  </span>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="rounded-[1.75rem] border border-white/10 bg-[#0E2142] p-6">
          <div className="flex flex-col gap-3 border-b border-white/10 pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-xl bg-[#153B7A] text-[#9FC2FF]">
                <Target size={20} />
              </span>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[.13em] text-[#7FAAF8]">
                  SALESPERSON TARGETS
                </p>
                <h2 className="font-display text-3xl font-bold text-white">
                  Targets Management Intelligence can explain.
                </h2>
              </div>
            </div>
            <Button
              onClick={saveTargets}
              disabled={saving === "targets"}
              className="bg-[#1B64F2] hover:bg-[#2B76FF]"
            >
              <Save className="mr-2 size-4" />
              {saving === "targets" ? "Saving…" : "Save targets"}
            </Button>
          </div>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead>
                <tr className="text-[10px] font-black uppercase tracking-[.12em] text-[#7896C1]">
                  <th className="pb-3">Salesperson</th>
                  <th className="pb-3">Daily CRM activity</th>
                  <th className="pb-3">Monthly won target ({currency})</th>
                  <th className="pb-3">Maximum overdue tasks</th>
                </tr>
              </thead>
              <tbody>
                {members
                  .filter(
                    member =>
                      member.isActive &&
                      ["salesperson", "manager", "owner"].includes(member.role)
                  )
                  .map(member => {
                    const target = row(member.userId);
                    return (
                      <tr
                        key={member.userId}
                        className="border-t border-white/8"
                      >
                        <td className="py-4 pr-4">
                          <p className="font-bold text-white">
                            {member.name ||
                              member.email ||
                              `User ${member.userId}`}
                          </p>
                          <p className="text-xs text-[#829CC4]">
                            {member.role}
                          </p>
                        </td>
                        <td className="py-4 pr-4">
                          <Input
                            type="number"
                            min={0}
                            value={target.dailyActivityTarget}
                            onChange={e =>
                              updateTarget(member.userId, {
                                dailyActivityTarget: Number(e.target.value),
                              })
                            }
                            className="w-40 border-white/15 bg-[#08172F] text-white"
                          />
                        </td>
                        <td className="py-4 pr-4">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={(
                              target.monthlyWonValueTargetMinor / 100
                            ).toFixed(2)}
                            onChange={e =>
                              updateTarget(member.userId, {
                                monthlyWonValueTargetMinor: Math.round(
                                  Number(e.target.value) * 100
                                ),
                              })
                            }
                            className="w-52 border-white/15 bg-[#08172F] text-white"
                          />
                        </td>
                        <td className="py-4">
                          <Input
                            type="number"
                            min={0}
                            value={target.maxOverdueTasks}
                            onChange={e =>
                              updateTarget(member.userId, {
                                maxOverdueTasks: Number(e.target.value),
                              })
                            }
                            className="w-40 border-white/15 bg-[#08172F] text-white"
                          />
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-[#829CC4]">
            <Users className="mt-0.5 size-4 shrink-0" />
            Amarktai compares actual CRM ownership/activity with these explicit
            targets. It does not generate a hidden AI employee score.
          </p>
        </section>

        <section className="rounded-[1.75rem] border border-white/10 bg-[#0E2142] p-6">
          <div className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[.13em] text-[#7FAAF8]">
                CLIENT WORKFLOW COMMISSIONING
              </p>
              <h2 className="mt-2 font-display text-3xl font-bold text-white">
                Keep each client's CRM rules separate from the product.
              </h2>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-[#A9BFDF]">
                Advanced management only. Export the active organisation's exact
                task progression, approved templates, senders, office hours,
                status mappings and duplicate rules before a reset, then validate
                and restore them to the intended client workspace. Salespeople do
                not edit this configuration.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={loadWorkflowConfiguration}
                disabled={saving === "workflow-load"}
                className="border-white/15 bg-[#08172F] text-white hover:bg-[#102A56]"
              >
                {saving === "workflow-load" ? "Loading…" : "Load / refresh rules"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={copyWorkflowConfiguration}
                disabled={!workflowConfigLoaded || !workflowConfigText}
                className="border-white/15 bg-[#08172F] text-white hover:bg-[#102A56]"
              >
                Copy export
              </Button>
              <Button
                type="button"
                onClick={saveWorkflowConfiguration}
                disabled={saving === "workflow-config" || !workflowConfigLoaded}
                className="bg-[#1B64F2] hover:bg-[#2B76FF]"
              >
                <Save className="mr-2 size-4" />
                {saving === "workflow-config" ? "Validating…" : "Validate & save"}
              </Button>
            </div>
          </div>
          {workflowConfigLoaded ? (
            <div className="mt-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-bold text-[#A9BFDF]">
                  Active organisation workflow configuration
                </p>
                {workflowConfigStatus ? (
                  <p className="rounded-full border border-white/10 bg-[#08172F] px-3 py-1 text-[11px] text-[#9FC2FF]">
                    {workflowConfigStatus}
                  </p>
                ) : null}
              </div>
              <textarea
                aria-label="Client workflow configuration JSON"
                value={workflowConfigText}
                onChange={event => {
                  setWorkflowConfigText(event.target.value);
                  setWorkflowConfigStatus("Unsaved changes");
                }}
                spellCheck={false}
                className="min-h-[420px] w-full rounded-xl border border-white/15 bg-[#061329] p-4 font-mono text-xs leading-5 text-[#DCE9FF] outline-none focus:border-[#6EA3FF]"
              />
              <p className="text-xs leading-5 text-[#829CC4]">
                Invalid task aliases, template channels, sender identities,
                email subjects, status rules, timing rules or office hours are
                rejected before they can replace the active configuration.
              </p>
            </div>
          ) : (
            <p className="mt-5 rounded-xl bg-[#08172F] p-4 text-sm text-[#9DB3D5]">
              Use <strong className="text-white">Load / refresh rules</strong>{" "}
              after management verification to inspect or export this
              organisation's current workflow configuration.
            </p>
          )}
        </section>

        <section className="rounded-[1.5rem] border border-[#3D69AD]/30 bg-[#102A56] p-5">
          <div className="flex gap-3">
            <Bot className="mt-0.5 size-5 text-[#9FC2FF]" />
            <p className="text-sm leading-6 text-[#C5D6EF]">
              <strong className="text-white">
                Management Intelligence remains deterministic.
              </strong>{" "}
              Amarktai Sales Assistant can optionally explain a complex
              situation, but it does not decide whether someone missed a target,
              has overdue tasks or has stale revenue.
            </p>
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-[#08172F] p-3">
      <p className="text-[10px] font-black uppercase tracking-[.12em] text-[#7896C1]">
        {label}
      </p>
      <p className="mt-1 font-display text-2xl font-bold text-white">{value}</p>
    </div>
  );
}

function PolicyChecks({
  title,
  options,
  selected,
  onToggle,
  emptyMeansAll = false,
}: {
  title: string;
  options: ReadonlyArray<readonly [string, string]>;
  selected: string[];
  onToggle: (value: string) => void;
  emptyMeansAll?: boolean;
}) {
  return (
    <div>
      <p className="text-xs font-bold text-[#A9BFDF]">{title}</p>
      {emptyMeansAll && !selected.length ? (
        <p className="mt-1 text-[11px] text-[#829CC4]">
          No selection currently allows all.
        </p>
      ) : null}
      <div className="mt-2 grid gap-2">
        {options.map(([value, label]) => (
          <label
            key={value}
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#08172F] p-2 text-xs text-[#C5D6EF]"
          >
            <input
              type="checkbox"
              checked={selected.includes(value)}
              onChange={() => onToggle(value)}
            />
            {label}
          </label>
        ))}
      </div>
    </div>
  );
}

function PolicyText({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-xs font-bold text-[#A9BFDF]">
      {label}
      <Input
        value={value}
        placeholder={placeholder}
        onChange={event => onChange(event.target.value)}
        className="mt-2 border-white/15 bg-[#08172F] text-white"
      />
    </label>
  );
}

function PolicyNumber({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="text-xs font-bold text-[#A9BFDF]">
      {label}
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={event => onChange(Number(event.target.value))}
        className="mt-2 border-white/15 bg-[#08172F] text-white"
      />
    </label>
  );
}
