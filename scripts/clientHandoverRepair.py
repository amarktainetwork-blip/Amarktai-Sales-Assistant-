from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(
            f"Expected exactly one match in {path}, found {count}: {old[:120]!r}"
        )
    p.write_text(text.replace(old, new, 1))


# Customer-facing Assistant: ordinary sales questions must reach real GenX.
replace_once(
    "server/assistantRoutes.ts",
    'import { runGenxAgent, type ChatMessage } from "./genx";\n',
    'import { runGenxAgent, type ChatMessage } from "./genx";\n'
    'import { isGovernedEvidenceAgent } from "./governedEvidenceAgents";\n'
    'import { getSalesWatchtower } from "./salesCommsWatchtower";\n'
    'import { getManagerWatchtower } from "./managerWatchtower";\n',
)
replace_once(
    "server/assistantRoutes.ts",
    '      const direct =\n'
    '        directAssistantAction(query) || deterministicTodayAnswer(query, today);\n',
    '      // Navigation-only shortcuts may return without AI. Sales questions\n'
    '      // continue through governed evidence plus the GenX response path below.\n'
    '      const direct = directAssistantAction(query);\n',
)
replace_once(
    "server/assistantRoutes.ts",
    '      const route = routeSalesCommand(query);\n'
    '      const contactContext = contactId\n',
    '      const route = routeSalesCommand(query);\n'
    '      const governedEvidence =\n'
    '        route.agentKey === "manager_watchtower"\n'
    '          ? await getManagerWatchtower({\n'
    '              userId,\n'
    '              organisationId: membership.organisationId,\n'
    '            })\n'
    '          : isGovernedEvidenceAgent(route.agentKey)\n'
    '            ? await getSalesWatchtower({\n'
    '                userId,\n'
    '                organisationId: membership.organisationId,\n'
    '                includePromises: route.agentKey === "promise_tracker",\n'
    '              })\n'
    '            : null;\n'
    '      const contactContext = contactId\n',
)
replace_once(
    "server/assistantRoutes.ts",
    '        requestRoute: route.summary,\n'
    '      });\n\n'
    '      const response = await runGenxAgent({\n'
    '        agentKey: route.agentKey,\n',
    '        requestRoute: route.summary,\n'
    '        governedEvidence,\n'
    '      });\n\n'
    '      const response = await runGenxAgent({\n'
    '        // Evidence specialists supply facts; GenX synthesizes the customer-facing answer.\n'
    '        agentKey: isGovernedEvidenceAgent(route.agentKey)\n'
    '          ? "supervisor"\n'
    '          : route.agentKey,\n',
)

# Never hide an empty provider response behind generic canned copy.
replace_once(
    "client/src/pages/Assistant.tsx",
    '  if (!response.ok)\n'
    '    throw new Error(body.error || "AmarktAI could not respond.");\n'
    '  return body;\n',
    '  if (!response.ok)\n'
    '    throw new Error(body.error || "AmarktAI could not respond.");\n'
    '  if (!body.content?.trim())\n'
    '    throw new Error("AmarktAI returned an empty intelligence response.");\n'
    '  return body;\n',
)
for _ in range(2):
    replace_once(
        "client/src/pages/Assistant.tsx",
        '          content:\n'
        '            response.content || "I’m ready. What would you like to do next?",\n',
        '          content: response.content!,\n',
    )

# Personal Today is always salesperson-scoped, even for managers/owners.
replace_once(
    "server/today.ts",
    'import { canViewTeamData, requireOrganisationMembership } from "./organisation";\n',
    'import { requireOrganisationMembership } from "./organisation";\n',
)
replace_once(
    "server/today.ts",
    '  const ownerIds = new Set(mappings.map(mapping => mapping.externalUserId));\n'
    '  const unrestricted = canViewTeamData(membership.role);\n'
    '  const belongsToUser = (ownerExternalId: string | null) =>\n'
    '    unrestricted || ownerIds.has(ownerExternalId ?? "");\n',
    '  const ownerIds = new Set(mappings.map(mapping => mapping.externalUserId));\n'
    '  const belongsToUser = (ownerExternalId: string | null) =>\n'
    '    ownerIds.has(ownerExternalId ?? "");\n',
)
replace_once(
    "server/today.ts",
    '      if (unrestricted) return true;\n'
    '      return belongsToUser(row.contactOwnerExternalId);\n',
    '      return belongsToUser(row.contactOwnerExternalId);\n',
)
replace_once(
    "server/today.ts",
    '    .filter(item => unrestricted || item.salespersonUserId === input.userId)\n',
    '    .filter(item => item.salespersonUserId === input.userId)\n',
)
replace_once(
    "server/today.ts",
    '    requiresOwnerMapping: !unrestricted && ownerIds.size === 0,\n',
    '    requiresOwnerMapping: ownerIds.size === 0,\n',
)

Path("server/personalCrmCustomers.ts").write_text(
    '''import { and, eq } from "drizzle-orm";
import { crmContacts, externalUserMappings } from "../drizzle/schema";
import { getDb, listCrmCustomers } from "./db";

/** Personal Customers/Assistant data is always scoped to the signed-in CRM owner mapping. */
export async function listPersonalCrmCustomers(input: {
  userId: number;
  organisationId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");

  const owned = await db
    .select({
      connectedSystemId: crmContacts.connectedSystemId,
      externalId: crmContacts.externalId,
    })
    .from(crmContacts)
    .innerJoin(
      externalUserMappings,
      and(
        eq(externalUserMappings.organisationId, input.organisationId),
        eq(externalUserMappings.connectedSystemId, crmContacts.connectedSystemId),
        eq(externalUserMappings.externalUserId, crmContacts.ownerExternalId),
        eq(externalUserMappings.userId, input.userId),
        eq(externalUserMappings.isActive, true)
      )
    )
    .where(eq(crmContacts.organisationId, input.organisationId));

  if (!owned.length) return [];
  const allowed = new Set(
    owned.map(contact => `${contact.connectedSystemId}:${contact.externalId}`)
  );
  const customers = await listCrmCustomers(input.organisationId);
  return customers.filter(customer =>
    allowed.has(`${customer.connectedSystemId}:${customer.externalId}`)
  );
}
'''
)
replace_once("server/routers.ts", '  listCrmCustomers,\n', "")
replace_once(
    "server/routers.ts",
    'import { getTodayWork } from "./today";\n',
    'import { getTodayWork } from "./today";\n'
    'import { listPersonalCrmCustomers } from "./personalCrmCustomers";\n',
)
replace_once(
    "server/routers.ts",
    '    customers: secondFactorProcedure.query(({ ctx }) => {\n'
    '      if (!ctx.activeOrganisation)\n'
    '        throw new Error("Choose an organisation before loading customers.");\n'
    '      return listCrmCustomers(ctx.activeOrganisation.organisationId);\n'
    '    }),\n',
    '    customers: secondFactorProcedure.query(({ ctx }) => {\n'
    '      if (!ctx.activeOrganisation)\n'
    '        throw new Error("Choose an organisation before loading customers.");\n'
    '      return listPersonalCrmCustomers({\n'
    '        userId: ctx.user.id,\n'
    '        organisationId: ctx.activeOrganisation.organisationId,\n'
    '      });\n'
    '    }),\n',
)

# Onboarding: show Outlook explicitly before CRM, then commission CRM read-only.
replace_once(
    "client/src/pages/Onboarding.tsx",
    '  Loader2,\n  Network,\n',
    '  Loader2,\n  Mail,\n  Network,\n',
)
replace_once(
    "client/src/pages/Onboarding.tsx",
    'type ProviderOption = {\n'
    '  provider: Provider;\n'
    '  label: string;\n'
    '  url: string;\n'
    '  method: "browser" | "oauth";\n'
    '};\n',
    'type ProviderOption = {\n'
    '  provider: Provider;\n'
    '  label: string;\n'
    '  url: string;\n'
    '  method: "browser" | "oauth";\n'
    '};\n\n'
    'type MailboxStatus = {\n'
    '  configured: boolean;\n'
    '  connected: boolean;\n'
    '  mailbox: null | { email: string; displayName?: string | null; status: string };\n'
    '};\n',
)
replace_once(
    "client/src/pages/Onboarding.tsx",
    '  const [customUrl, setCustomUrl] = useState("");\n'
    '  const [error, setError] = useState("");\n',
    '  const [customUrl, setCustomUrl] = useState("");\n'
    '  const [error, setError] = useState("");\n'
    '  const [mailboxStatus, setMailboxStatus] = useState<MailboxStatus | null>(null);\n',
)
replace_once(
    "client/src/pages/Onboarding.tsx",
    '  useEffect(() => {\n'
    '    const mode = organisation.data?.settings?.workspaceMode;\n'
    '    if (mode === "individual" || mode === "team") setWorkspaceMode(mode);\n'
    '  }, [organisation.data?.settings?.workspaceMode]);\n',
    '  useEffect(() => {\n'
    '    const mode = organisation.data?.settings?.workspaceMode;\n'
    '    if (mode === "individual" || mode === "team") setWorkspaceMode(mode);\n'
    '  }, [organisation.data?.settings?.workspaceMode]);\n\n'
    '  useEffect(() => {\n'
    '    let cancelled = false;\n'
    '    const loadMailbox = async () => {\n'
    '      const response = await fetch("/api/mailbox", { credentials: "include" });\n'
    '      if (!response.ok || cancelled) return;\n'
    '      const body = (await response.json().catch(() => null)) as MailboxStatus | null;\n'
    '      if (body && !cancelled) setMailboxStatus(body);\n'
    '    };\n'
    '    void loadMailbox();\n'
    '    const timer = window.setInterval(() => void loadMailbox(), 4_000);\n'
    '    return () => {\n'
    '      cancelled = true;\n'
    '      window.clearInterval(timer);\n'
    '    };\n'
    '  }, []);\n',
)
replace_once(
    "client/src/pages/Onboarding.tsx",
    '  const connectedSystems = systems.data ?? [];\n'
    '  const crmConnected = connectedSystems.length > 0;\n',
    '  const connectedSystems = systems.data ?? [];\n'
    '  const crmConnected = connectedSystems.length > 0;\n'
    '  const mailboxConnected = Boolean(mailboxStatus?.connected);\n',
)
replace_once(
    "client/src/pages/Onboarding.tsx",
    '    if (!knowledgeConfirmed) return 2;\n'
    '    if (!crmConnected) return 3;\n'
    '    return 4;\n'
    '  }, [workspaceMode, profileSaved, knowledgeConfirmed, crmConnected]);\n',
    '    if (!knowledgeConfirmed) return 2;\n'
    '    if (!mailboxConnected) return 3;\n'
    '    if (!crmConnected) return 4;\n'
    '    return 5;\n'
    '  }, [workspaceMode, profileSaved, knowledgeConfirmed, mailboxConnected, crmConnected]);\n',
)
replace_once(
    "client/src/pages/Onboarding.tsx",
    '        allowedReadCapabilities,\n'
    '        allowedWriteCapabilities,\n',
    '        allowedReadCapabilities,\n'
    '        // Onboarding proves reads only. Writes require later explicit commissioning.\n'
    '        allowedWriteCapabilities: [],\n',
)
replace_once(
    "client/src/pages/Onboarding.tsx",
    '      await updateOnboarding.mutateAsync({ step: 3 });\n',
    '      await updateOnboarding.mutateAsync({ step: 4 });\n',
)
replace_once(
    "client/src/pages/Onboarding.tsx",
    '  const labels = ["Business", "Learn", "CRM", "Ready"];\n',
    '  const labels = ["Business", "Learn", "Outlook", "CRM", "Ready"];\n',
)
replace_once(
    "client/src/pages/Onboarding.tsx",
    '        <div className="mt-5 grid gap-3 sm:grid-cols-4">\n',
    '        <div className="mt-5 grid gap-3 sm:grid-cols-5">\n',
)
crm_marker = '''      {step === 3 ? (
        <section className="mt-7">
          <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#35516F]">
            STEP 3 · YOUR CRM
'''
email_block = '''      {step === 3 ? (
        <section className="mt-7">
          <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#35516F]">
            STEP 3 · YOUR OUTLOOK MAILBOX
          </p>
          <h3 className="mt-2 text-2xl font-bold tracking-[-.035em] text-[#203047]">
            Connect the mailbox you already use for sales.
          </h3>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#607086]">
            Connect Microsoft Outlook with the existing secure sign-in. AmarktAI uses your own mailbox for customer context and reviewed follow-ups; connecting it does not send anything.
          </p>
          {mailboxStatus?.configured === false ? (
            <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Microsoft mailbox connection is not configured on this installation yet.
            </div>
          ) : null}
          <Button
            className="mt-5"
            disabled={mailboxStatus?.configured === false}
            onClick={() => window.location.assign("/api/mailbox/microsoft/start")}
          >
            <Mail className="mr-2 h-4 w-4" /> Connect Outlook
          </Button>
          {mailboxStatus?.connected && mailboxStatus.mailbox ? (
            <p className="mt-3 text-sm font-semibold text-emerald-700">
              Connected as {mailboxStatus.mailbox.email}
            </p>
          ) : null}
        </section>
      ) : null}

      {step === 4 ? (
        <section className="mt-7">
          <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#35516F]">
            STEP 4 · YOUR CRM
'''
replace_once("client/src/pages/Onboarding.tsx", crm_marker, email_block)
replace_once(
    "client/src/pages/Onboarding.tsx",
    '''      {step === 4 ? (
        <section className="mt-7">
          <p className="text-[10px] font-black uppercase tracking-[.14em] text-emerald-700">
            STEP 4 · FINISH SETUP
''',
    '''      {step === 5 ? (
        <section className="mt-7">
          <p className="text-[10px] font-black uppercase tracking-[.14em] text-emerald-700">
            STEP 5 · FINISH SETUP
''',
)

# CRM screen: expose commissioning progress and require explicit salesperson identity.
replace_once(
    "client/src/pages/CrmWorkspace.tsx",
    '  Sparkles,\n  X,\n',
    '  Sparkles,\n  CheckCircle2,\n  X,\n',
)
replace_once(
    "client/src/pages/CrmWorkspace.tsx",
    '  const [commissioningReady, setCommissioningReady] = useState(false);\n',
    '''  const [commissioningReady, setCommissioningReady] = useState(false);
  const [commissioningJob, setCommissioningJob] = useState<{
    state?: string;
    status?: string;
    humanStatus?: string;
    lastError?: string | null;
    progress?: { humanStatus?: string; safeReads?: { status?: string } };
  } | null>(null);
  const [crmIdentityMapped, setCrmIdentityMapped] = useState(false);
''',
)
replace_once(
    "client/src/pages/CrmWorkspace.tsx",
    '    setCommissioningReady(false);\n'
    '    setBrowserAuthenticationState("STARTING");\n',
    '    setCommissioningReady(false);\n'
    '    setCommissioningJob(null);\n'
    '    setBrowserAuthenticationState("STARTING");\n',
)
replace_once(
    "client/src/pages/CrmWorkspace.tsx",
    '''      const body = (await response.json().catch(() => ({}))) as {
        job?: { state?: string; status?: string } | null;
      };
      setCommissioningReady(
        body.job?.state === "READY" && body.job?.status === "ready"
      );
''',
    '''      const body = (await response.json().catch(() => ({}))) as {
        job?: {
          state?: string;
          status?: string;
          humanStatus?: string;
          lastError?: string | null;
          progress?: { humanStatus?: string; safeReads?: { status?: string } };
        } | null;
      };
      setCommissioningJob(body.job ?? null);
      setCommissioningReady(
        body.job?.state === "READY" && body.job?.status === "ready"
      );
''',
)
replace_once(
    "client/src/pages/CrmWorkspace.tsx",
    '      !commissioningReady ||\n'
    '      !automationPolicyConfigured ||\n',
    '      !commissioningReady ||\n'
    '      !crmIdentityMapped ||\n'
    '      !automationPolicyConfigured ||\n',
)
replace_once(
    "client/src/pages/CrmWorkspace.tsx",
    '    commissioningReady,\n'
    '    utils.organisation.current,\n',
    '    commissioningReady,\n'
    '    crmIdentityMapped,\n'
    '    utils.organisation.current,\n',
)
replace_once(
    "client/src/pages/CrmWorkspace.tsx",
    '        {canManage &&\n'
    '        !onboardingComplete &&\n',
    '''        {canManage &&
        !onboardingComplete &&
        browserAuthenticationState === "AUTHENTICATED" ? (
          <div className="absolute left-1/2 top-3 z-30 w-[min(94%,760px)] -translate-x-1/2 rounded-2xl border border-[#C7D4E4] bg-white/95 p-4 shadow-[0_14px_40px_rgba(20,48,84,.16)] backdrop-blur">
            <div className="flex items-start gap-3">
              {commissioningReady ? (
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
              ) : (
                <Loader2 className="mt-0.5 size-5 shrink-0 animate-spin text-[#2865C7]" />
              )}
              <div className="min-w-0">
                <p className="font-bold text-[#203047]">
                  {commissioningReady
                    ? "CRM learning complete"
                    : `AmarktAI is learning ${selected?.displayName || "your CRM"}`}
                </p>
                <p className="mt-1 text-sm text-[#607086]">
                  {commissioningJob?.progress?.humanStatus ||
                    commissioningJob?.humanStatus ||
                    "Checking the signed-in CRM and finding safe read functions…"}
                </p>
                {commissioningJob?.lastError ? (
                  <p className="mt-2 text-xs font-semibold text-amber-800">
                    {commissioningJob.lastError}
                  </p>
                ) : null}
                <p className="mt-2 text-xs text-[#718096]">
                  Setup starts with read-only CRM access. No CRM record is changed during onboarding.
                </p>
              </div>
            </div>
            <CrmIdentitySetup
              active={commissioningReady}
              onMapped={setCrmIdentityMapped}
            />
          </div>
        ) : null}
        {canManage &&
        !onboardingComplete &&
''',
)

identity_component = '''
function CrmIdentitySetup({
  active,
  onMapped,
}: {
  active: boolean;
  onMapped: (mapped: boolean) => void;
}) {
  const [state, setState] = useState<{
    mapped: boolean;
    current: Array<{ id: number; displayName: string; email: string | null }>;
    candidates: Array<{ id: number; displayName: string; email: string | null }>;
  } | null>(null);
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    if (!active) {
      onMapped(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const response = await fetch("/api/team/crm-identity", {
        credentials: "include",
      });
      if (!response.ok || cancelled) return;
      const body = (await response.json()) as NonNullable<typeof state>;
      if (cancelled) return;
      setState(body);
      onMapped(body.mapped);
    };
    void load();
    const timer = window.setInterval(() => void load(), 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active, onMapped]);

  if (!active || state?.mapped) return null;
  const candidate = state?.candidates?.[0];
  return (
    <div className="mt-3 border-t border-[#E0E7F0] pt-3">
      <p className="text-sm font-bold text-[#203047]">
        Confirm your salesperson identity
      </p>
      <p className="mt-1 text-xs leading-5 text-[#607086]">
        Your personal workspace only shows CRM records owned by your mapped salesperson identity. Team-wide records stay in management views.
      </p>
      {candidate ? (
        <Button
          size="sm"
          className="mt-3"
          disabled={claiming}
          onClick={async () => {
            setClaiming(true);
            try {
              const response = await fetch("/api/team/crm-identity", {
                method: "PUT",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mappingId: candidate.id }),
              });
              const body = (await response.json().catch(() => ({}))) as {
                error?: string;
              };
              if (!response.ok)
                throw new Error(
                  body.error || "CRM identity could not be confirmed."
                );
              onMapped(true);
              setState(current =>
                current ? { ...current, mapped: true } : current
              );
            } catch (error) {
              toast.error(
                friendlyError(error, "CRM identity could not be confirmed.")
              );
            } finally {
              setClaiming(false);
            }
          }}
        >
          {claiming ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          Use {candidate.displayName}
          {candidate.email ? ` · ${candidate.email}` : ""}
        </Button>
      ) : (
        <p className="mt-2 text-xs font-semibold text-amber-800">
          Waiting for the CRM owner list to synchronize. AmarktAI only offers an identity with the same signed-in email; it will not guess by name.
        </p>
      )}
    </div>
  );
}
'''
p = Path("client/src/pages/CrmWorkspace.tsx")
text = p.read_text()
marker = "\nfunction LiveWorkspace({\n"
if text.count(marker) != 1:
    raise SystemExit("CrmWorkspace LiveWorkspace marker mismatch")
p.write_text(text.replace(marker, "\n" + identity_component + marker, 1))

Path("server/clientHandoverAcceptance.test.ts").write_text(
    '''import { describe, expect, it } from "vitest";
import fs from "node:fs";

const assistant = fs.readFileSync("server/assistantRoutes.ts", "utf8");
const today = fs.readFileSync("server/today.ts", "utf8");
const onboarding = fs.readFileSync("client/src/pages/Onboarding.tsx", "utf8");
const crm = fs.readFileSync("client/src/pages/CrmWorkspace.tsx", "utf8");
const routers = fs.readFileSync("server/routers.ts", "utf8");

function compact(value: string) {
  return value.replace(/\\s+/g, " ");
}

describe("client handover acceptance guards", () => {
  it("routes ordinary sales questions through evidence plus GenX", () => {
    expect(assistant).not.toContain(
      "directAssistantAction(query) || deterministicTodayAnswer(query, today)"
    );
    expect(assistant).toContain("governedEvidence");
    expect(assistant).toContain(
      "agentKey: isGovernedEvidenceAgent(route.agentKey)"
    );
  });

  it("keeps personal Today salesperson-scoped for managers too", () => {
    expect(today).not.toContain("canViewTeamData");
    expect(today).not.toContain("unrestricted || ownerIds.has");
    expect(today).toContain("requiresOwnerMapping: ownerIds.size === 0");
  });

  it("scopes personal Customers by signed-in user", () => {
    expect(compact(routers)).toContain(
      compact("return listPersonalCrmCustomers({ userId: ctx.user.id")
    );
  });

  it("puts Outlook before read-only CRM commissioning", () => {
    expect(onboarding).toContain(
      '["Business", "Learn", "Outlook", "CRM", "Ready"]'
    );
    expect(onboarding).toContain("/api/mailbox/microsoft/start");
    expect(compact(onboarding)).toContain("allowedWriteCapabilities: []");
  });

  it("shows CRM learning and requires salesperson identity mapping", () => {
    expect(crm).toContain("AmarktAI is learning");
    expect(crm).toContain("/api/team/crm-identity");
    expect(crm).toContain("!crmIdentityMapped");
  });
});
'''
)
