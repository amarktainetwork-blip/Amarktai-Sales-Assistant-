from pathlib import Path

p = Path("server/crm/canonicalActionExecution.ts")
text = p.read_text()

old_import = '''import {
  createDelegatedOutlookCalendarEvent,
  sendDelegatedOutlookMail,
} from "../delegatedMailbox";
import {
  findDelegatedSentMailByReference,
  waitForDelegatedSentMailReadback,
} from "../delegatedMailboxReadback";'''
new_import = '''import {
  createPersonalMailboxCalendarEvent,
  findPersonalSentMailByReference,
  sendPersonalMailboxMail,
  waitForPersonalSentMailReadback,
  type PersonalMailboxProvider,
} from "../personalMailboxRuntime";'''
if text.count(old_import) != 1:
    raise SystemExit(f"canonical mailbox import count={text.count(old_import)}")
text = text.replace(old_import, new_import, 1)

if text.count("function stableMicrosoftReference(") != 1:
    raise SystemExit("stableMicrosoftReference marker missing")
text = text.replace("function stableMicrosoftReference(", "function stableMailboxReference(", 1)

start = text.index("async function executeMicrosoft(")
end = text.index("async function verifyCrmPostcondition", start)
new_exec = r'''async function executePersonalMailbox(input: {
  organisationId: number;
  proposal: ActionProposal;
  correlationId: string;
  payload: Record<string, unknown>;
}) {
  const route = object(input.payload.crmRoute);
  const rawProvider =
    route.provider === "microsoft_delegated" ? "microsoft" : route.mailboxProvider;
  if (
    rawProvider !== "microsoft" &&
    rawProvider !== "google" &&
    rawProvider !== "smtp"
  )
    throw new Error(
      "The reviewed personal mailbox provider is no longer available. Re-review the action after reconnecting the mailbox."
    );
  const provider = rawProvider as PersonalMailboxProvider;
  const reference = stableMailboxReference(input.proposal);

  if (
    input.proposal.actionType === "send_email" ||
    input.proposal.actionType === "send_email_template"
  ) {
    if (provider !== "smtp") {
      const prior = await findPersonalSentMailByReference({
        userId: input.proposal.userId,
        organisationId: input.organisationId,
        provider,
        reviewReference: reference,
      });
      if (prior.found)
        return {
          success: true,
          skipped: true,
          duplicatePrevented: true,
          detail:
            "Sent mail already contains this exact approved action reference, so the email was not sent twice.",
          provider: `${provider}_personal`,
          correlationId: input.correlationId,
          completedAt:
            "sentDateTime" in prior && typeof prior.sentDateTime === "string"
              ? prior.sentDateTime
              : new Date().toISOString(),
          providerResult: prior,
          retryable: false,
        };
    }

    const sent = await sendPersonalMailboxMail({
      userId: input.proposal.userId,
      organisationId: input.organisationId,
      provider,
      to: String(input.payload.to ?? input.payload.email ?? ""),
      subject: String(input.payload.subject ?? input.proposal.title),
      body: String(input.payload.body ?? input.payload.message ?? ""),
      reviewReference: reference,
      contactExternalId:
        typeof input.payload.contactExternalId === "string"
          ? input.payload.contactExternalId
          : undefined,
    });

    if (provider === "smtp")
      return {
        success: Boolean(sent.sent),
        acceptedByProvider: Boolean(sent.sent),
        detail: sent.sent
          ? "The verified SMTP server accepted the approved email. This connection has no sent-folder readback, so the stable Message-ID and review reference are retained and blind retry is disabled."
          : "The SMTP server did not accept the approved email.",
        provider: "smtp_personal",
        correlationId: input.correlationId,
        completedAt: new Date().toISOString(),
        providerResult: sent,
        sentReadbackSupported: false,
        retryable: false,
      };

    const readback = await waitForPersonalSentMailReadback({
      userId: input.proposal.userId,
      organisationId: input.organisationId,
      provider,
      reviewReference: reference,
    });
    if (!readback.found)
      return {
        success: false,
        acceptedByProvider: true,
        detail:
          "The mailbox provider accepted the approved email, but sent-mail readback was not visible in the bounded verification window. The stable action reference prevents blind resend; reconcile before any retry.",
        provider: `${provider}_personal`,
        correlationId: input.correlationId,
        completedAt: new Date().toISOString(),
        providerResult: readback,
        retryable: false,
      };
    return {
      success: true,
      detail:
        "The approved email was sent from the salesperson's personal mailbox and read back using the stable action reference.",
      provider: `${provider}_personal`,
      correlationId: input.correlationId,
      completedAt:
        "sentDateTime" in readback && typeof readback.sentDateTime === "string"
          ? readback.sentDateTime
          : new Date().toISOString(),
      providerResult: readback,
      retryable: false,
    };
  }

  if (input.proposal.actionType === "create_calendar_event") {
    const startIso =
      typeof input.payload.startIso === "string"
        ? input.payload.startIso
        : typeof input.payload.start === "string"
          ? input.payload.start
          : "";
    const endIso =
      typeof input.payload.endIso === "string"
        ? input.payload.endIso
        : typeof input.payload.end === "string"
          ? input.payload.end
          : "";
    const result = await createPersonalMailboxCalendarEvent({
      userId: input.proposal.userId,
      organisationId: input.organisationId,
      provider,
      subject: String(
        input.payload.subject ?? input.payload.title ?? input.proposal.title
      ),
      body: String(
        input.payload.body ??
          input.payload.message ??
          input.payload.content ??
          input.proposal.title
      ),
      startIso,
      endIso,
      attendees: calendarAttendees(input.payload, input.proposal.targetLabel),
      timezone:
        typeof input.payload.timezone === "string"
          ? input.payload.timezone
          : undefined,
      reviewReference: reference,
    });
    return {
      success: Boolean(result.eventId),
      detail: result.eventId
        ? "The approved calendar invitation was created with a stable external reference and returned an event ID."
        : "The mailbox calendar provider did not return an event ID. Do not retry until the stable action reference is reconciled.",
      provider: `${provider}_personal`,
      correlationId: input.correlationId,
      completedAt: new Date().toISOString(),
      providerResult: result,
      retryable: false,
    };
  }
  throw new Error("Unsupported personal mailbox action.");
}

'''
text = text[:start] + new_exec + text[end:]

old_owner = '"EMAIL_EXECUTION_OWNER_INVALID: salesperson email must execute through the user\'s delegated Microsoft mailbox."'
if text.count(old_owner) != 1:
    raise SystemExit(f"owner error marker count={text.count(old_owner)}")
text = text.replace(
    old_owner,
    '"EMAIL_EXECUTION_OWNER_INVALID: salesperson email must execute through the reviewed personal mailbox route."',
    1,
)

old_dispatch = '''  if (route.provider === "microsoft_delegated")
    return executeMicrosoft({ ...input, payload });'''
if text.count(old_dispatch) != 1:
    raise SystemExit(f"dispatch marker count={text.count(old_dispatch)}")
text = text.replace(
    old_dispatch,
    '''  if (
    route.provider === "microsoft_delegated" ||
    route.provider === "personal_mailbox"
  )
    return executePersonalMailbox({ ...input, payload });''',
    1,
)

p.write_text(text)
