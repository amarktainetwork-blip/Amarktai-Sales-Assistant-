# Genie commissioning and Teach Amarktai

This release implements the repository-side Genie/browser-CRM framework. It does not claim that a client operation is live before a controlled replay succeeds in that client's authorised CRM account.

## CRM-native function model

Amarktai does not require separate client-facing SMS, WhatsApp or sales-email gateways. Those are functions of the connected CRM when that CRM provides them. The same rule applies to dialler actions, quotes, appointments, ownership changes, workflows and other CRM-specific controls.

Common CRM work uses normalized capability names so the rest of Amarktai can work consistently across providers. Browser CRMs can additionally learn any client-specific function through **Teach another CRM function**:

- `custom.read.<name>` for read-only functions.
- `custom.write.<name>` for functions that change the CRM or trigger an external action.

A custom write remains fail-closed until target identity and postcondition checks succeed in a controlled replay. Routing to a browser CRM never makes a custom action safe by itself: the exact learned operation must be `LIVE_PROVEN` at execution time.

SMTP remains a deployment requirement only for Amarktai account security and system mail such as second factor, recovery, invitations and reports. Optional personal Microsoft mailbox support uses per-user delegated OAuth and only participates in workflows explicitly commissioned by that user.

## Truth model

- `NOT_LEARNED`: no organisation/connection-specific demonstration exists.
- `LEARNED`: privacy-filtered semantic training was captured; it is not executable.
- `TEST_READY`: a manager reviewed a deterministic definition, target assertions, and (for writes) postcondition assertions.
- `LIVE_PROVEN`: controlled replay succeeded against an authorised target and evidence was stored.
- `DEGRADED`: a previously live operation failed a safe watchdog/readback check. Only that operation is disabled.
- `BLOCKED`: verification failed or the operation is unsafe to execute.

Connection authentication is not operation readiness. Broad normalized capabilities are `FULL` only when all required operations are independently `LIVE_PROVEN`; partial coverage is `LIMITED`. A limited connection can still execute any individual capability that has been independently verified. Missing or drifted functions do not disable unrelated proven functions.

## Commissioning flow

1. Create the Genie or Other CRM Connected System with its real HTTPS login URL. Authorise only the required host/path. Genie derives its normal login profile from this connection URL; install-level `GENIE_*` settings are fallback diagnostics only.
2. Open the CRM in the **Secure CRM Browser**. The customer types their username, password, SSO approval and verification code directly into the real Genie page; Amarktai never asks for or stores those values.
3. Confirm sign-in only after Genie finishes loading. Amarktai requires meaningful authenticated application structure on an authorised domain and never treats a generic page or the customer confirmation alone as authentication proof.
4. If sign-in redirects to an unrecognised identity-provider hostname, an elevated manager approves that hostname before the browser may continue. Operation calibration begins only after the authenticated session is established.
5. If authentication redirects through another public hostname, approve only the exact hostname reported by the blocked test for this connection. Private-network redirects remain blocked. MFA, SSO and CAPTCHA are never bypassed; without a securely commissioned reusable session the result is `GENIE_INTERACTIVE_AUTH_REQUIRED`.
6. Issue a short-lived Sidecar session and connect the Sidecar on the authorised CRM tab.
7. For a common function, choose **Teach** in the operation matrix. For anything else the CRM exposes, use **Teach another CRM function**, give it a clear name, and classify it as read-only or write.
8. Copy the generated Training Session ID into the Sidecar together with the Connected System ID.
9. Demonstrate only that operation. The Sidecar records semantic roles/names, stable attributes, labels, selectors and navigation results. It never reads cookies, tokens, full page dumps, or input values; sensitive fields are redacted and ordinary inputs become placeholders.
10. Review the capture and convert it to the smallest deterministic script. Read/sync operations should use `read_rows`, `read_value`, or bounded `paginate_rows`; do not use `document.body.innerText` as structured integration.
11. For writes, configure a `targetRead` script and exact target assertions. Require an external ID or two stable fields. Configure a separate `postconditionRead` plus explicit postcondition assertions.
12. Save as `TEST_READY`, enable Shadow Mode for initial observation, and run a controlled replay using an authorised dummy record.
13. Publish `LIVE_PROVEN` only when the intended target and postcondition are proven. Then refresh capability truth and run sync. Today can launch the Genie dialler only when `dialler.launch` itself is `LIVE_PROVEN`; otherwise it directs the user back to dialler setup and offers a distinctly labelled external-phone path.

The expert JSON endpoint remains available for reviewed/debug commissioning, but routine customer onboarding uses the guided Connected Systems and Sidecar flow.

## Standard operation coverage for Genie acceptance

The built-in matrix covers the common functions Amarktai needs for a telesales workflow:

- authentication/login
- contact search, open, read, sync, create and update
- company read, sync and create
- opportunity read, sync, create and update
- task/manual-action list, read, sync, create, complete and callback creation
- conversation/history and activity read/write
- notes
- owners
- pipelines and stages
- CRM-native email, SMS and WhatsApp when present
- sequences when present

Anything client-specific that is not in this list is added as a CRM-specific learned function rather than by adding another external provider.

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

## Personal mailbox commissioning

When Microsoft 365 is intentionally commissioned, configure the delegated OAuth adapter and let each user consent to their own account. The user-owned background worker performs bounded, paginated inbox sync through delegated Graph access; messages are deduplicated, matched to normalized contacts, classified, surfaced in Today, and converted to a fail-closed suppression on unsubscribe. Draft replies remain review-controlled. No shared sender, application permission or public inbound-mail webhook is part of this runtime.

## External acceptance

Use client-provided dummy contacts/tasks/opportunities and test templates. Do not test writes against real customer records. Normal deterministic replay makes zero GenX calls. A true client selector set, field mapping, account permissions, templates, and Webdock connectivity cannot be proven in repository CI; those are proven during client commissioning.
