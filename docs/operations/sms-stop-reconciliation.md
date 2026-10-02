# One-time cached SMS STOP reconciliation

Purpose: correct previously ingested standalone SMS opt-out messages that were incorrectly classified as a reply, including messages already archived but missing a communication-suppression record. This **only** updates AmarktAI's local source-derived cache and suppression/work state. It does not use Genie, send SMS, or enable any CRM write action.

Prerequisites: verified production release with `server/communications/reconcileCachedSmsOptOutsCli.ts` included in the built `dist`; a fresh verified database backup; the exact organisation, connected-system and salesperson mailbox IDs; `allowedWriteCapabilities=[]`. Do not use another person's mailbox ID. Run from the authorised VPS shell.

```sh
docker exec \
  -e AMARKTAI_COMMISSION_ORGANISATION_ID=<verified-organisation-id> \
  -e AMARKTAI_COMMISSION_CONNECTED_SYSTEM_ID=<verified-genie-system-id> \
  -e AMARKTAI_COMMISSION_USER_ID=<verified-mailbox-user-id> \
  webdock-app-1 node dist/communications/reconcileCachedSmsOptOutsCli.js
```

The script selects up to 100 genuine stored SMS messages with exact standalone STOP-like text when any of these remain wrong: needsAction, unsubscribe classification, or per-sender suppression. It validates each immutable message idempotency key and reprocesses it through the existing owner-scoped ingestion path. An archived message stays archived. A new reply is **never** sent. On success it logs counts only, no personal message content.

Exit 0 means the bounded batch converged (if the source contains further non-matching messages, they are outside this exact keyword repair). Exit 2 means exactly 100 rows were checked; repeat the command until it returns 0. Any other error is fail-closed: inspect source identity/ownership evidence rather than bypass the guard.

Acceptance: inspect the exact affected local message and confirm `classification.category='unsubscribe'`, `needsAction=false`, existing status preserved if archived, a matching local `contactCommunicationSuppressions` entry and completed inbound work; re-open Today and Inbox and verify that counts agree and that the STOP does not reappear. All external CRM writes remain disabled. Do not mark a message read or replied in Genie just to clear the local indicator.
