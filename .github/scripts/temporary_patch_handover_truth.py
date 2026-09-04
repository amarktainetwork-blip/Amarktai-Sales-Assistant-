from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: {label} count={count}")
    p.write_text(text.replace(old, new, 1))

# Server operations dashboard: distinguish deployment configuration from the user's actual connected mailbox.
p = Path("server/routers.ts")
text = p.read_text()
old_import = '''import {
  getPersonalMailboxReadiness,
  validatePersonalMailboxEmailPreview,
} from "./personalMailbox";'''
new_import = '''import {
  getPersonalMailboxReadiness,
  validatePersonalMailboxEmailPreview,
} from "./personalMailbox";
import { getPersonalMailboxStatus } from "./personalMailboxRuntime";'''
if text.count(old_import) != 1:
    raise SystemExit(f"routers mailbox import count={text.count(old_import)}")
text = text.replace(old_import, new_import, 1)
old_field = "          personalMailbox: getPersonalMailboxReadiness().ready,"
if text.count(old_field) != 1:
    raise SystemExit(f"operations dashboard mailbox readiness field count={text.count(old_field)}")
text = text.replace(
    old_field,
    '''          personalMailbox: (
            await getPersonalMailboxStatus({
              userId: ctx.user.id,
              organisationId: ctx.activeOrganisation.organisationId,
            })
          ).connected,''',
    1,
)
text = text.replace(
    "The email was not sent. Check your Microsoft mailbox connection and try again.",
    "The email was not sent. Check your personal mailbox connection and try again.",
)
text = text.replace(
    "Microsoft accepted this approved email, but delivery readback could not be verified. Review now marks it Failed. Do not resend it until the stable action reference is reconciled.",
    "The mailbox provider accepted this approved email, but sent-mail readback could not be verified. Review now marks it Failed. Do not resend it until the stable action reference is reconciled.",
)
p.write_text(text)

# CRM workspace: final commissioning state, never intermediate safe-read progress.
p = Path("client/src/pages/CrmWorkspace.tsx")
text = p.read_text()
replacements = [
    ("const [safeReadsReady, setSafeReadsReady] = useState(false);", "const [commissioningReady, setCommissioningReady] = useState(false);", "CRM readiness state"),
    ("    setSafeReadsReady(false);", "    setCommissioningReady(false);", "CRM readiness reset"),
    ('        job?: { progress?: { safeReads?: { status?: string } } } | null;', '        job?: { state?: string; status?: string } | null;', "commissioning response type"),
    ('      if (body.job?.progress?.safeReads?.status === "Ready")\n        setSafeReadsReady(true);', '      setCommissioningReady(\n        body.job?.state === "READY" && body.job?.status === "ready"\n      );', "final commissioning predicate"),
    ("      !safeReadsReady ||", "      !commissioningReady ||", "completion predicate"),
    ("    safeReadsReady,", "    commissioningReady,", "completion dependency"),
    ("Setup is ready, but completion could not be saved. Try reopening the CRM.", "CRM commissioning is not fully proven yet, or completion could not be saved. Finish the required CRM operations and try again.", "completion error copy"),
]
for old, new, label in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"CrmWorkspace {label} count={count}")
    text = text.replace(old, new, 1)
p.write_text(text)

# Dashboard shell: canonical Genie readiness, not raw connected-system status.
p = Path("client/src/components/DashboardLayout.tsx")
text = p.read_text()
connected_block = '''  const connectedSystems = trpc.connectedSystems.list.useQuery(
    { organisationId: organisationId ?? 0 },
    {
      enabled: Boolean(
        user && security.data?.verified && canManage && organisationId
      ),
      retry: false,
    }
  );'''
if text.count(connected_block) != 1:
    raise SystemExit(f"Dashboard connected systems block count={text.count(connected_block)}")
text = text.replace(
    connected_block,
    connected_block + '''
  const integrationReadiness = trpc.integrations.list.useQuery(undefined, {
    enabled: Boolean(
      user && security.data?.verified && canManage && organisationId
    ),
    retry: false,
  });''',
    1,
)
old_ready = '''  const crmReady = Boolean(
    connectedSystems.data?.some(
      system =>
        system.status === "ready" || system.status === "limited_permissions"
    )
  );'''
if text.count(old_ready) != 1:
    raise SystemExit(f"Dashboard raw CRM readiness count={text.count(old_ready)}")
text = text.replace(
    old_ready,
    "  const crmReady = Boolean(integrationReadiness.data?.genie.ready);",
    1,
)
p.write_text(text)
