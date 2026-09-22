import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { friendlyError } from "@/lib/friendlyError";
import {
  BookOpenCheck,
  CheckCircle2,
  FlaskConical,
  History,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type SkillRow = {
  id: number;
  playbookKey: string;
  version: number;
  title: string;
  instructions: string;
  inputSchema: Record<string, unknown>;
  status: "draft" | "published" | "archived";
  updatedAt: string;
  simulation: Simulation;
};

type TemplateRow = {
  id: number;
  templateKey: string;
  version: number;
  title: string;
  status: "draft" | "published" | "archived";
  updatedAt: string;
};

type Simulation = {
  valid: boolean;
  checks: Array<{ key: string; passed: boolean; detail: string }>;
  trace: string[];
};

type CapabilityPlan = {
  connectedSystem: {
    id: number;
    provider: string;
    displayName: string;
    connectionMethod: string;
  };
  writeCapabilities: Array<{
    capability: string;
    description: string;
    currentlyAllowed: boolean;
    currentlyVerified: boolean;
  }>;
  operations: Array<{
    key: string;
    label: string;
    mode: "read" | "write";
    status: string;
    liveProven: boolean;
  }>;
  missingReadOperations: Array<{ key: string; label: string }>;
  missingWriteOperations: Array<{ key: string; label: string }>;
  writeApprovalRequired: boolean;
  writeApproval: {
    status: string;
    connectedSystemId?: number;
  };
  canSimulateReadOnly: boolean;
  canExecuteWrites: boolean;
};

type Catalogue = {
  templates: TemplateRow[];
  readiness: {
    connectedSystemId: number | null;
    operationKey: string;
    status: string;
    readOnly: true;
  };
};

type SkillList = {
  skills: SkillRow[];
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok)
    throw new Error(body.error || "Teach AmarktAI could not complete that request.");
  return body;
}

function statusLabel(status: string) {
  return status.replace(/_/g, " ").toLowerCase();
}

export function SkillStudio({
  connectedSystemId,
}: {
  organisationId: number;
  connectedSystemId?: number;
}) {
  const [view, setView] = useState<"skills" | "templates">("skills");
  const [data, setData] = useState<SkillList | null>(null);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [simulation, setSimulation] = useState<Record<number, Simulation>>({});
  const [capabilityPlans, setCapabilityPlans] = useState<
    Record<number, CapabilityPlan>
  >({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [sop, setSop] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      const query = connectedSystemId
        ? `?connectedSystemId=${connectedSystemId}`
        : "";
      const [skills, templates] = await Promise.all([
        api<SkillList>("/api/team-admin/skills"),
        api<Catalogue>(`/api/team-admin/template-catalogue${query}`),
      ]);
      setData(skills);
      setCatalogue(templates);
      if (connectedSystemId) {
        const currentByKey = new Map<string, SkillRow>();
        for (const skill of skills.skills) {
          const existing = currentByKey.get(skill.playbookKey);
          if (
            !existing ||
            (skill.status === "published" && existing.status !== "published") ||
            (skill.status === existing.status && skill.version > existing.version)
          )
            currentByKey.set(skill.playbookKey, skill);
        }
        const planEntries = await Promise.all(
          Array.from(currentByKey.values()).map(async skill => {
            try {
              const plan = await api<CapabilityPlan>(
                `/api/team-admin/skills/${skill.id}/capability-plan?connectedSystemId=${connectedSystemId}`
              );
              return [skill.id, plan] as const;
            } catch {
              return undefined;
            }
          })
        );
        setCapabilityPlans(
          Object.fromEntries(
            planEntries.filter(
              (entry): entry is readonly [number, CapabilityPlan] =>
                Boolean(entry)
            )
          )
        );
      } else setCapabilityPlans({});
    } catch (cause) {
      setError(friendlyError(cause, "Skills and templates could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [connectedSystemId]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const grouped = new Map<string, SkillRow[]>();
    for (const skill of data?.skills || []) {
      const current = grouped.get(skill.playbookKey) || [];
      current.push(skill);
      grouped.set(skill.playbookKey, current);
    }
    return Array.from(grouped.entries())
      .map(([key, versions]) => [
        key,
        versions.sort((a, b) => b.version - a.version),
      ] as const)
      .sort((a, b) => a[1][0].title.localeCompare(b[1][0].title));
  }, [data?.skills]);

  async function createSkill(event: React.FormEvent) {
    event.preventDefault();
    try {
      setBusy("create");
      const created = await api<{
        id: number;
        title: string;
        simulation: Simulation;
        creditsCharged: number;
      }>("/api/team-admin/skills/compile", {
        method: "POST",
        body: JSON.stringify({ sop }),
      });
      setSimulation(current => ({
        ...current,
        [created.id]: created.simulation,
      }));
      setCreating(false);
      setSop("");
      toast.success(
        created.simulation.valid
          ? `${created.title} was compiled and its logic checks passed. Review it before publishing.`
          : `${created.title} was saved as a draft with mappings or checks still to resolve.`
      );
      await load();
    } catch (cause) {
      toast.error(
        friendlyError(cause, "AmarktAI could not compile that skill safely.")
      );
    } finally {
      setBusy("");
    }
  }

  async function simulate(id: number) {
    try {
      setBusy(`simulate-${id}`);
      const result = await api<Simulation>(
        `/api/team-admin/skills/${id}/simulate`,
        { method: "POST", body: "{}" }
      );
      setSimulation(current => ({ ...current, [id]: result }));
      toast[result.valid ? "success" : "error"](
        result.valid
          ? "Simulation passed. This version is ready for review."
          : "Simulation found checks that must be resolved."
      );
    } catch (cause) {
      toast.error(friendlyError(cause, "The skill simulation could not run."));
    } finally {
      setBusy("");
    }
  }

  async function changeSkill(
    id: number,
    action: "publish" | "rollback" | "archive"
  ) {
    try {
      setBusy(`${action}-${id}`);
      await api(`/api/team-admin/skills/${id}/${action}`, {
        method: "PUT",
        body: "{}",
      });
      toast.success(
        action === "rollback"
          ? "The selected version is published again."
          : `Skill ${action} complete.`
      );
      await load();
    } catch (cause) {
      toast.error(friendlyError(cause, `The skill could not be ${action}ed.`));
    } finally {
      setBusy("");
    }
  }

  async function approveWriteCommissioning(id: number) {
    if (!connectedSystemId) {
      toast.error("Connect the CRM before approving write commissioning.");
      return;
    }
    try {
      setBusy(`approve-write-${id}`);
      const result = await api<{ id: number; version: number }>(
        `/api/team-admin/skills/${id}/approve-write-commissioning`,
        {
          method: "POST",
          body: JSON.stringify({
            connectedSystemId,
            confirmWriteCommissioning: true,
          }),
        }
      );
      toast.success(
        `Write commissioning approved for skill version ${result.version}. No CRM write was enabled or executed.`
      );
      await load();
    } catch (cause) {
      toast.error(
        friendlyError(cause, "The write commissioning plan was not approved.")
      );
    } finally {
      setBusy("");
    }
  }

  async function syncTemplates() {
    if (!connectedSystemId) return;
    try {
      setBusy("sync-templates");
      const result = await api<{ imported: number; unchanged: number }>(
        "/api/team-admin/template-catalogue/sync",
        {
          method: "POST",
          body: JSON.stringify({ connectedSystemId }),
        }
      );
      toast.success(
        `${result.imported} template revision(s) imported; ${result.unchanged} unchanged.`
      );
      await load();
    } catch (cause) {
      toast.error(
        friendlyError(cause, "The read-only template catalogue could not sync.")
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <section id="skills" className="amk-skill-studio" data-skill-builder>
      <div className="amk-skill-studio__header">
        <div>
          <p className="amk-workspace-eyebrow">Teach AmarktAI</p>
          <h2>Skills &amp; approved templates</h2>
          <p>
            Turn your organisation’s process into tested, versioned instructions.
            Skills prepare reviewable work; they cannot edit source code or bypass
            connection permissions.
          </p>
        </div>
        <div className="amk-skill-studio__tabs" role="tablist">
          <button
            type="button"
            className={view === "skills" ? "is-active" : ""}
            onClick={() => setView("skills")}
          >
            <Sparkles size={16} /> Skills
          </button>
          <button
            type="button"
            className={view === "templates" ? "is-active" : ""}
            onClick={() => setView("templates")}
          >
            <BookOpenCheck size={16} /> Template catalogue
          </button>
        </div>
      </div>

      {loading ? (
        <p className="amk-skill-empty">
          <Loader2 className="animate-spin" size={17} /> Loading organisation skills…
        </p>
      ) : error ? (
        <div role="alert" className="amk-skill-alert">
          <p>{error}</p>
          <Button variant="outline" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : view === "skills" ? (
        <>
          <div className="amk-skill-toolbar">
            <div>
              <strong>{groups.length} organisation skill{groups.length === 1 ? "" : "s"}</strong>
              <span>Draft → simulate → publish → restore when needed</span>
            </div>
            <Button onClick={() => setCreating(value => !value)}>
              <Sparkles className="mr-2 h-4 w-4" />
              {creating ? "Close teacher" : "Teach a skill"}
            </Button>
          </div>

          {creating ? (
            <form className="amk-skill-form" onSubmit={createSkill}>
              <label className="amk-skill-form__wide">
                Describe the process exactly as your team follows it
                <Textarea
                  rows={12}
                  value={sop}
                  onChange={event => setSop(event.target.value)}
                  placeholder="Example: When a new lead has an invalid phone number, send our Invalid Phone Number email, wait one full day, check for a reply, and only then prepare the approved close-file process..."
                  required
                />
              </label>
              <div className="amk-skill-form__wide amk-skill-form__actions">
                <span>
                  AmarktAI will turn this into a bounded organisation skill,
                  identify missing mappings, run deterministic checks and save a
                  versioned draft. No CRM write or customer message is executed
                  while teaching.
                </span>
                <Button
                  type="submit"
                  disabled={busy === "create" || sop.trim().length < 40}
                >
                  {busy === "create" ? "Learning & testing…" : "Compile & test"}
                </Button>
              </div>
            </form>
          ) : null}

          <div className="amk-skill-list">
            {groups.length ? (
              groups.map(([key, versions]) => {
                const current =
                  versions.find(version => version.status === "published") ||
                  versions[0];
                const result = simulation[current.id] || current.simulation;
                const plan = capabilityPlans[current.id];
                return (
                  <article className="amk-skill-card" key={key}>
                    <div className="amk-skill-card__main">
                      <span className={`amk-status amk-status--${current.status}`}>
                        {statusLabel(current.status)}
                      </span>
                      <h3>{current.title}</h3>
                      <p>{current.instructions}</p>
                      <small>
                        Version {current.version} · {versions.length} revision{versions.length === 1 ? "" : "s"}
                      </small>
                    </div>
                    <div className="amk-skill-card__actions">
                      <Button variant="outline" onClick={() => void simulate(current.id)} disabled={busy === `simulate-${current.id}`}>
                        <FlaskConical className="mr-2 h-4 w-4" />
                        Simulate
                      </Button>
                      {current.status === "draft" ? (
                        <Button
                          onClick={() => void changeSkill(current.id, "publish")}
                          disabled={
                            !result?.valid ||
                            Boolean(plan?.writeApprovalRequired) ||
                            Boolean(
                              plan?.writeCapabilities.length &&
                                !plan.canExecuteWrites
                            ) ||
                            busy === `publish-${current.id}`
                          }
                        >
                          Publish
                        </Button>
                      ) : null}
                    </div>
                    {plan?.writeCapabilities.length ? (
                      <div className="amk-skill-write-warning">
                        <div>
                          <strong>
                            {plan.writeApprovalRequired
                              ? "Your approval is required before AmarktAI learns or commissions these Genie writes."
                              : plan.canExecuteWrites
                                ? "Write capability commissioned and proven."
                                : "Approved to commission — Genie proof is still required."}
                          </strong>
                          <p>
                            This skill may need to{" "}
                            {plan.writeCapabilities
                              .map(item => item.description)
                              .join("; ")}.
                          </p>
                          <p>
                            Approval never sends a message or changes a CRM record.
                            It authorises commissioning for this skill only; Review
                            and autonomy permissions remain separate.
                          </p>
                          {plan.missingWriteOperations.length ? (
                            <small>
                              Still to prove:{" "}
                              {plan.missingWriteOperations
                                .map(item => item.label)
                                .join(", ")}
                            </small>
                          ) : null}
                        </div>
                        <div className="amk-skill-write-warning__actions">
                          {plan.writeApprovalRequired ? (
                            <Button
                              onClick={() =>
                                void approveWriteCommissioning(current.id)
                              }
                              disabled={
                                busy === `approve-write-${current.id}`
                              }
                            >
                              {busy === `approve-write-${current.id}`
                                ? "Approving…"
                                : "Approve commissioning"}
                            </Button>
                          ) : !plan.canExecuteWrites ? (
                            <a href="/connections">Open CRM setup</a>
                          ) : null}
                        </div>
                      </div>
                    ) : plan?.missingReadOperations.length ? (
                      <div className="amk-skill-read-warning">
                        <strong>Genie needs to learn a read function for this skill.</strong>
                        <p>
                          Missing:{" "}
                          {plan.missingReadOperations
                            .map(item => item.label)
                            .join(", ")}
                        </p>
                        <a href="/connections">Teach / prove CRM functions</a>
                      </div>
                    ) : null}
                    {result ? (
                      <div className="amk-simulation">
                        {result.checks.map(check => (
                          <span className={check.passed ? "is-pass" : "is-fail"} key={check.key}>
                            {check.passed ? <CheckCircle2 size={14} /> : <ShieldCheck size={14} />}
                            {check.detail}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {versions.length > 1 ? (
                      <details className="amk-skill-history">
                        <summary><History size={15} /> Version history</summary>
                        {versions.map(version => (
                          <div key={version.id}>
                            <span>v{version.version} · {statusLabel(version.status)}</span>
                            {version.status === "archived" ? (
                              <button type="button" onClick={() => void changeSkill(version.id, "rollback")}>
                                Restore
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </details>
                    ) : null}
                  </article>
                );
              })
            ) : (
              <p className="amk-skill-empty">No organisation skills yet. Create the first reviewed skill here.</p>
            )}
          </div>
        </>
      ) : (
        <div className="amk-template-catalogue">
          <div className="amk-catalogue-status">
            <div>
              <span className={`amk-status amk-status--${catalogue?.readiness.status === "LIVE_PROVEN" ? "published" : "draft"}`}>
                {catalogue?.readiness.status || "NOT_LEARNED"}
              </span>
              <h3>Genie template catalogue</h3>
              <p>
                Uses <code>custom.read.templates</code> only. Sync reads the CRM and creates reviewable draft revisions; it never sends or changes a CRM record.
              </p>
            </div>
            <Button onClick={() => void syncTemplates()} disabled={!connectedSystemId || catalogue?.readiness.status !== "LIVE_PROVEN" || busy === "sync-templates"}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {busy === "sync-templates" ? "Reading…" : "Sync read-only"}
            </Button>
          </div>
          <div className="amk-template-grid">
            {(catalogue?.templates || []).map(template => (
              <article key={template.id}>
                <span className={`amk-status amk-status--${template.status}`}>{template.status}</span>
                <h4>{template.title}</h4>
                <p>{template.templateKey}</p>
                <small>Version {template.version}</small>
              </article>
            ))}
          </div>
          {!catalogue?.templates.length ? (
            <p className="amk-skill-empty">
              No templates are stored yet. Teach and prove the read-only catalogue operation in the CRM connection, then sync here.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
