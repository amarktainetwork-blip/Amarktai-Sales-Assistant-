# Genie commissioning and Teach Amarktai

This release implements the repository-side Genie framework. It does not claim that a client operation is live before a controlled replay succeeds in that client's authorised Genie account.

## Truth model

- `NOT_LEARNED`: no organisation/connection-specific demonstration exists.
- `LEARNED`: privacy-filtered semantic training was captured; it is not executable.
- `TEST_READY`: a manager reviewed a deterministic definition, target assertions, and (for writes) postcondition assertions.
- `LIVE_PROVEN`: controlled replay succeeded against an authorised target and evidence was stored.
- `DEGRADED`: a previously live operation failed a safe watchdog/readback check. Only that operation is disabled.
- `BLOCKED`: verification failed or the operation is unsafe to execute.

Connection authentication is not operation readiness. Broad capabilities are `FULL` only when all required operations are independently `LIVE_PROVEN`; partial coverage is `LIMITED`.

## Commissioning flow

1. Create the Genie Connected System with its real HTTPS login URL. Authorise only the required host/path.
2. Save the client username/password through **Secure sign-in**. These values use the existing encrypted connection-secret store and are never returned by an API.
3. Issue a short-lived Sidecar session and connect the Sidecar on the authorised Genie tab.
4. In the operation matrix choose **Teach** for one operation. Copy the generated Training Session ID into the Sidecar together with the Connected System ID.
5. Demonstrate only that operation. The Sidecar records semantic roles/names, stable attributes, labels, selectors and navigation results. It never reads cookies, tokens, full page dumps, or input values; sensitive fields are redacted and ordinary inputs become placeholders.
6. Review the capture and convert it to the smallest deterministic script. Read/sync operations should use `read_rows`, `read_value`, or bounded `paginate_rows`; do not use `document.body.innerText` as structured integration.
7. For writes, configure a `targetRead` script and exact target assertions. Require an external ID or two stable fields. Configure a separate `postconditionRead` plus explicit postcondition assertions.
8. Save as `TEST_READY`, enable Shadow Mode for initial observation, and run a controlled replay using an authorised dummy record.
9. Publish `LIVE_PROVEN` only when the intended target and postcondition are proven. Then refresh capability truth and run sync.

The expert JSON endpoint remains available for reviewed/debug commissioning, but routine customer onboarding uses the guided Connected Systems and Sidecar flow.

## Deterministic operation definition

The manager API accepts a versioned definition with:

```json
{
  "mode": "write",
  "targetRead": {
    "steps": [
      {
        "action": "read_rows",
        "selector": "[data-testid='contact-header']",
        "key": "targets",
        "fields": {
          "externalId": {
            "selector": "[data-record-id]",
            "attribute": "data-record-id"
          },
          "email": { "selector": "[data-field='email']" }
        }
      }
    ]
  },
  "execute": {
    "steps": [
      {
        "action": "fill",
        "selector": "textarea[name='note']",
        "value": "{{noteBody}}"
      },
      { "action": "click", "selector": "button[data-testid='save-note']" }
    ]
  },
  "postconditionRead": {
    "steps": [
      {
        "action": "read_text",
        "selector": "[data-testid='notes']",
        "key": "notes"
      }
    ]
  }
}
```

The accompanying postcondition is `{ "actualKey": "notes", "expectedInput": "noteBody", "comparator": "contains" }`. This is illustrative only; never copy guessed selectors into a client profile.

## Inbound Outlook commissioning

Outbound Graph variables remain unchanged. To accept Graph change notifications, also configure a random 24+ character `OUTLOOK_WEBHOOK_CLIENT_STATE` and the intended `OUTLOOK_INBOUND_ORGANISATION_ID`, grant the required application mail-read permission, and register `/api/outlook/inbound` as the notification URL. Notifications are client-state checked, fetched from Graph, deduplicated, matched to normalized contacts, classified, surfaced in Today, and converted to a fail-closed suppression on unsubscribe. Draft replies remain review-controlled.

## External acceptance

Use client-provided dummy contacts/tasks/opportunities and test templates. Do not test writes against real customer records. Normal deterministic replay makes zero GenX calls. A true client selector set, field mapping, account permissions, templates, and Webdock connectivity cannot be proven in repository CI.
