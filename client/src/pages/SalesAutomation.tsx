import DashboardLayout from "@/components/DashboardLayout";
import ManagementElevation from "@/components/ManagementElevation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import {
  CheckCircle2,
  CircleAlert,
  Loader2,
  Mail,
  MessageSquareText,
  Send,
  Sparkles,
  Workflow,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

type System = {
  id: number;
  provider: string;
  displayName: string;
  status: string;
  verifiedCapabilities: string[];
};
type Capabilities = {
  policy: {
    mode: "advise" | "review" | "auto_preapproved";
    autoActionTypes: string[];
  };
  actionTypes: string[];
  systems: System[];
};

const actions = [
  ["append_contact_note", "Add CRM note"],
  ["schedule_callback", "Create callback / task"],
  ["complete_active_task", "Complete CRM task"],
  ["send_email", "Send email"],
  ["send_sms", "Send SMS"],
  ["send_whatsapp", "Send WhatsApp"],
  ["update_contact", "Update contact"],
  ["update_opportunity", "Update opportunity"],
  ["create_contact", "Create contact"],
  ["create_company", "Create company"],
  ["create_opportunity", "Create opportunity"],
  ["create_activity", "Log activity"],
  ["apply_sequence", "Apply CRM sequence"],
  ["custom_crm_action", "Calibrated browser action"],
] as const;

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

export default function SalesAutomation() {
  const [, navigate] = useLocation();
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionType, setActionType] = useState<string>("append_contact_note");
  const [selectedCustomerKey, setSelectedCustomerKey] = useState("");
  const [target, setTarget] = useState("");
  const [preferredProvider, setPreferredProvider] = useState("");
  const [externalId, setExternalId] = useState("");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [sequence, setSequence] = useState("");
  const [customAction, setCustomAction] = useState("");
  const [fieldsJson, setFieldsJson] = useState("{}");
  const [fieldName, setFieldName] = useState("");
  const [fieldValue, setFieldValue] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const isMessage = ["send_email", "send_sms", "send_whatsapp"].includes(
    actionType
  );
  const isFields = [
    "update_contact",
    "update_opportunity",
    "create_contact",
    "create_company",
    "create_opportunity",
    "create_activity",
  ].includes(actionType);
  const systems = useMemo(
    () =>
      capabilities?.systems.filter(system => system.status === "ready") || [],
    [capabilities]
  );
  const organisation = trpc.organisation.current.useQuery();
  const management = trpc.managementElevation.status.useQuery(undefined, {
    retry: false,
  });
  const customers = trpc.sales.customers.useQuery();
  const canManage =
    organisation.data?.role === "owner" ||
    organisation.data?.role === "manager";
  const advancedAllowed = canManage && management.data?.elevated === true;

  useEffect(() => {
    request<Capabilities>("/api/sales-automation/capabilities")
      .then(setCapabilities)
      .catch(error => toast.error(error.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (advancedAllowed) return;
    setAdvanced(false);
    if (["complete_active_task", "custom_crm_action"].includes(actionType))
      setActionType("append_contact_note");
  }, [actionType, advancedAllowed]);

  async function prepare() {
    if (!target.trim())
      return toast.error("Choose the CRM record/contact you are working on.");
    try {
      setSubmitting(true);
      let fields: Record<string, unknown> = {};
      if (isFields) {
        if (advanced && advancedAllowed) {
          const parsed = JSON.parse(fieldsJson);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            throw new Error("CRM fields must be a JSON object.");
          fields = parsed;
        } else {
          if (!fieldName.trim())
            throw new Error("Choose the CRM field to change.");
          fields = { [fieldName.trim()]: fieldValue };
        }
      }
      const payload: Record<string, unknown> = {
        preferredProvider: preferredProvider || undefined,
        externalId: externalId || undefined,
        contactExternalId: externalId || undefined,
      };
      if (actionType === "append_contact_note") payload.content = body;
      if (actionType === "schedule_callback") {
        payload.taskTitle = subject || "Follow up";
        payload.dueAt = dueAt ? new Date(dueAt).toISOString() : undefined;
      }
      if (actionType === "complete_active_task")
        payload.taskExternalId = externalId;
      if (isMessage) {
        payload.to = to;
        payload.subject = actionType === "send_email" ? subject : undefined;
        payload.body = body;
      }
      if (isFields) payload.fields = fields;
      if (actionType === "apply_sequence") payload.sequence = sequence;
      if (actionType === "custom_crm_action") payload.actionName = customAction;
      const result = await request<{
        mode: string;
        workflowRunId?: number;
        proposalCount?: number;
        blockedActionCount?: number;
        autoExecutions?: Array<{ success: boolean; detail?: string }>;
      }>("/api/sales-automation/prepare", {
        method: "POST",
        body: JSON.stringify({
          label: target,
          action: {
            actionType,
            title: actions.find(item => item[0] === actionType)?.[1],
            targetLabel: target,
            externalId: externalId || undefined,
            payload,
          },
        }),
      });
      if (result.mode === "advise")
        toast.success(
          "Action checked in advise-only mode; nothing external was changed."
        );
      else if (result.autoExecutions?.length)
        toast.success(
          result.autoExecutions.every(item => item.success)
            ? "Pre-approved action executed and recorded."
            : "Automation ran, but one action needs attention."
        );
      else toast.success("Action prepared for review in Approvals.");
      if (result.workflowRunId) navigate("/workspace");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Action could not be prepared."
      );
    } finally {
      setSubmitting(false);
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
      <div className="mx-auto max-w-[1450px] space-y-6">
        <header className="border-b border-white/10 pb-7">
          <p className="text-[10px] font-black uppercase tracking-[.16em] text-[#83AEFF]">
            UNIVERSAL SALES AUTOMATION
          </p>
          <h1 className="mt-2 font-display text-5xl font-bold tracking-[-.07em] text-white">
            Do the CRM work without doing the CRM admin.
          </h1>
          <p className="mt-3 max-w-4xl text-sm leading-6 text-[#A9BFDF]">
            Choose a customer and prepare the note, follow-up, message or CRM
            update you need. Amarktai uses only functions that passed the CRM's
            readiness checks, and sends reviewable work to Approvals.
          </p>
        </header>

        <div className="grid gap-6 xl:grid-cols-[1.15fr_.85fr]">
          <section className="rounded-[1.75rem] border border-white/10 bg-[#0E2142] p-6 sm:p-7">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-xl bg-[#153B7A] text-[#9FC2FF]">
                <Workflow size={20} />
              </span>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#7FAAF8]">
                  NEXT ACTION
                </p>
                <h2 className="font-display text-3xl font-bold tracking-[-.05em] text-white">
                  Tell Amarktai what should happen.
                </h2>
              </div>
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <Field label="Action">
                <select
                  value={actionType}
                  onChange={e => setActionType(e.target.value)}
                  className="h-11 rounded-xl border border-white/15 bg-[#08172F] px-3 text-sm text-white"
                >
                  {actions
                    .filter(
                      ([value]) =>
                        !["complete_active_task", "custom_crm_action"].includes(
                          value
                        ) || advancedAllowed
                    )
                    .map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Customer">
                <select
                  value={selectedCustomerKey}
                  onChange={event => {
                    const key = event.target.value;
                    const customer = customers.data?.find(
                      item =>
                        `${item.connectedSystemId}:${item.externalId}` === key
                    );
                    setSelectedCustomerKey(key);
                    setExternalId(customer?.externalId || "");
                    if (customer) {
                      setTarget(customer.name);
                      const system = systems.find(
                        item => item.id === customer.connectedSystemId
                      );
                      setPreferredProvider(system?.provider || "");
                    }
                  }}
                  className="h-11 rounded-xl border border-white/15 bg-[#08172F] px-3 text-sm text-white"
                >
                  <option value="">Choose a synchronized CRM customer</option>
                  {customers.data?.map(customer => {
                    const key = `${customer.connectedSystemId}:${customer.externalId}`;
                    return (
                      <option key={key} value={key}>
                        {customer.name}
                        {customer.companyName
                          ? ` · ${customer.companyName}`
                          : ""}
                      </option>
                    );
                  })}
                </select>
              </Field>
            </div>
            <div className="mt-4">
              <Field label="Contact / record label">
                <Input
                  value={target}
                  onChange={e => setTarget(e.target.value)}
                  placeholder="Jane Smith"
                  className="border-white/15 bg-[#08172F] text-white"
                />
              </Field>
            </div>
            {actionType === "append_contact_note" && (
              <FieldBlock label="CRM note">
                <textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  rows={6}
                  placeholder="Factual note to add to the record…"
                  className="w-full rounded-xl border border-white/15 bg-[#08172F] p-3 text-sm text-white outline-none"
                />
              </FieldBlock>
            )}
            {actionType === "schedule_callback" && (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <Field label="Task title">
                  <Input
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                    placeholder="Follow up"
                    className="border-white/15 bg-[#08172F] text-white"
                  />
                </Field>
                <Field label="Due date/time">
                  <Input
                    type="datetime-local"
                    value={dueAt}
                    onChange={e => setDueAt(e.target.value)}
                    className="border-white/15 bg-[#08172F] text-white"
                  />
                </Field>
              </div>
            )}
            {isMessage && (
              <>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <Field
                    label={
                      actionType === "send_email"
                        ? "Email address (optional if CRM contact resolves)"
                        : "Phone number (optional if CRM contact resolves)"
                    }
                  >
                    <Input
                      value={to}
                      onChange={e => setTo(e.target.value)}
                      className="border-white/15 bg-[#08172F] text-white"
                    />
                  </Field>
                  {actionType === "send_email" && (
                    <Field label="Subject">
                      <Input
                        value={subject}
                        onChange={e => setSubject(e.target.value)}
                        className="border-white/15 bg-[#08172F] text-white"
                      />
                    </Field>
                  )}
                </div>
                <FieldBlock label="Message">
                  <textarea
                    value={body}
                    onChange={e => setBody(e.target.value)}
                    rows={7}
                    placeholder="Approved message…"
                    className="w-full rounded-xl border border-white/15 bg-[#08172F] p-3 text-sm text-white outline-none"
                  />
                </FieldBlock>
              </>
            )}
            {isFields && (
              <FieldBlock label="What should change?">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    value={fieldName}
                    onChange={event => setFieldName(event.target.value)}
                    placeholder="Field, for example stage"
                    className="border-white/15 bg-[#08172F] text-white"
                  />
                  <Input
                    value={fieldValue}
                    onChange={event => setFieldValue(event.target.value)}
                    placeholder="New value"
                    className="border-white/15 bg-[#08172F] text-white"
                  />
                </div>
              </FieldBlock>
            )}
            {actionType === "apply_sequence" && (
              <FieldBlock label="Sequence">
                <Input
                  value={sequence}
                  onChange={e => setSequence(e.target.value)}
                  placeholder="Sequence name / identifier"
                  className="border-white/15 bg-[#08172F] text-white"
                />
              </FieldBlock>
            )}
            {actionType === "custom_crm_action" && (
              <FieldBlock label="Reviewed browser action name">
                <Input
                  value={customAction}
                  onChange={e => setCustomAction(e.target.value)}
                  placeholder="approvedActionName"
                  className="border-white/15 bg-[#08172F] text-white"
                />
                <p className="mt-2 text-xs text-[#829CC4]">
                  Only a saved action present in the calibrated browser profile
                  can execute. Arbitrary JavaScript is not permitted.
                </p>
              </FieldBlock>
            )}
            <Button
              onClick={prepare}
              disabled={submitting || !systems.length}
              className="mt-6 h-12 w-full bg-[#1B64F2] text-base font-bold hover:bg-[#2B76FF]"
            >
              {submitting ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Send className="mr-2 size-4" />
              )}
              {capabilities?.policy.mode === "auto_preapproved"
                ? "Prepare / execute if pre-approved"
                : capabilities?.policy.mode === "advise"
                  ? "Check action"
                  : "Prepare for review"}
            </Button>
          </section>

          <aside className="space-y-4">
            {canManage && <ManagementElevation />}
            <article className="rounded-[1.5rem] border border-white/10 bg-[#0E2142] p-6">
              <div className="flex items-center gap-2 text-[#A9C7FF]">
                <Sparkles size={17} />
                <span className="text-[10px] font-black uppercase tracking-[.13em]">
                  AUTOMATION MODE
                </span>
              </div>
              <p className="mt-3 font-display text-3xl font-bold capitalize text-white">
                {capabilities?.policy.mode.replaceAll("_", " ")}
              </p>
              <p className="mt-3 text-sm leading-6 text-[#A9BFDF]">
                {capabilities?.policy.mode === "advise"
                  ? "Amarktai can plan and advise, but no action is persisted for execution."
                  : capabilities?.policy.mode === "review"
                    ? "Actions go to Approvals for a human decision before an external change."
                    : "Only management-preapproved action types can execute automatically. Everything else remains in review."}
              </p>
            </article>
            {advancedAllowed && (
              <details className="rounded-[1.5rem] border border-white/10 bg-[#0E2142] p-6">
                <summary className="cursor-pointer font-bold text-[#A9C7FF]">
                  Advanced diagnostics
                </summary>
                <div className="mt-4 space-y-4">
                  <label className="flex items-center gap-2 text-xs font-bold text-[#A9BFDF]">
                    <input
                      type="checkbox"
                      checked={advanced}
                      onChange={event => setAdvanced(event.target.checked)}
                    />
                    Use advanced CRM routing fields
                  </label>
                  {advanced && (
                    <>
                      <Field label="Preferred connected system">
                        <select
                          value={preferredProvider}
                          onChange={event =>
                            setPreferredProvider(event.target.value)
                          }
                          className="h-11 w-full rounded-xl border border-white/15 bg-[#08172F] px-3 text-sm text-white"
                        >
                          <option value="">Automatic verified route</option>
                          {systems.map(system => (
                            <option key={system.id} value={system.provider}>
                              {system.displayName}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="External CRM record ID">
                        <Input
                          value={externalId}
                          onChange={event => setExternalId(event.target.value)}
                          className="border-white/15 bg-[#08172F] text-white"
                        />
                      </Field>
                      {isFields && (
                        <Field label="Reviewed CRM field object">
                          <textarea
                            value={fieldsJson}
                            onChange={event =>
                              setFieldsJson(event.target.value)
                            }
                            rows={7}
                            className="w-full rounded-xl border border-white/15 bg-[#08172F] p-3 font-mono text-xs text-white outline-none"
                          />
                        </Field>
                      )}
                    </>
                  )}
                </div>
              </details>
            )}
            <article className="rounded-[1.5rem] border border-white/10 bg-[#0E2142] p-6">
              <p className="text-[10px] font-black uppercase tracking-[.13em] text-[#7FAAF8]">
                READY CONNECTIONS
              </p>
              <div className="mt-4 space-y-3">
                {systems.length ? (
                  systems.map(system => (
                    <div
                      key={system.id}
                      className="rounded-xl bg-[#08172F] p-4"
                    >
                      <div className="flex items-center justify-between">
                        <p className="font-bold text-white">
                          {system.displayName}
                        </p>
                        <CheckCircle2 className="size-4 text-emerald-300" />
                      </div>
                      <p className="mt-1 text-xs text-[#829CC4]">
                        {system.provider} · {system.verifiedCapabilities.length}{" "}
                        verified capabilities
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-amber-300/20 bg-amber-400/[.05] p-4 text-sm text-amber-100">
                    <CircleAlert className="mb-2 size-5" />
                    Connect and verify a CRM before preparing external actions.
                  </div>
                )}
              </div>
            </article>
            <article className="rounded-[1.5rem] border border-white/10 bg-[#0E2142] p-6">
              <div className="flex gap-3">
                <Mail className="mt-0.5 size-5 text-[#8CB7FF]" />
                <div>
                  <h3 className="font-bold text-white">
                    Communication routing
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-[#A9BFDF]">
                    Email, SMS and WhatsApp are offered only when the connected
                    CRM account exposes that function and its readiness check
                    has passed. Unavailable channels stay unavailable.
                  </p>
                </div>
              </div>
              <div className="mt-4 flex gap-2 text-[#7FAAF8]">
                <Mail size={16} />
                <MessageSquareText size={16} />
                <Send size={16} />
              </div>
            </article>
          </aside>
        </div>
      </div>
    </DashboardLayout>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-[10px] font-black uppercase tracking-[.13em] text-[#8CA9D4]">
        {label}
      </span>
      {children}
    </label>
  );
}
function FieldBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4">
      <p className="mb-2 text-[10px] font-black uppercase tracking-[.13em] text-[#8CA9D4]">
        {label}
      </p>
      {children}
    </div>
  );
}
