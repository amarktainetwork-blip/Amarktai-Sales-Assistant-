# Integration Research Notes

## Personal mailbox and calendar

Microsoft 365 is the first personal-mailbox adapter and uses **Microsoft Graph with per-user delegated OAuth**. Every user connects and consents to their own account; there is no deployment-level shared sender or application-permission mailbox. Microsoft documents Outlook as a surface for mail, contacts, scheduling, and related workflow data, and the application requests only the permissions required by the enabled feature set.[1]

For calendar scheduling, Graph supports creating events in a user’s default or specified calendar using `POST /me/events` or related user/calendar paths. The documented least-privilege permission for event creation is `Calendars.ReadWrite`; Graph also supports a client-supplied `transactionId` to reduce unnecessary retries.[2]

The active runtime performs bounded background sync through each user's delegated Graph access. It deliberately has no public inbound-mail webhook. Read scopes are least-privilege, and write scopes are used only for approved delivery and scheduling actions.

## Genie CRM

The approved generic CRM-browser architecture uses **authorised browser automation rather than an assumed CRM API**. The Webdock installation starts an internal Chromium/CDP service, and the application connects through Playwright using an isolated, connection-scoped browser session and reviewed page selectors. The customer enters credentials and MFA directly into that private browser; Amarktai neither receives nor stores them. It deliberately has no hard-coded CRM API-key requirement.

The browser bridge follows a **learn once, save script, replay script** approach. Authentication requires conservative structural and safe-read evidence; known CRM presets additionally require a strong provider-specific authenticated marker. A scheduled worker checks the Genie session and dashboard marker every 12 hours. When Genie changes, risky scripts pause pending a selector repair and reviewed retest; the assistant must not guess a substitute action.

## GenX Model Provider

No authoritative GenX model-provider API reference was located. The application therefore provides a server-side adapter which is intentionally dormant until the deployment receives the exact chat-completions URL, API key, and default model identifier. The adapter expects an OpenAI-style chat-completions response envelope and does not expose any provider credential to the browser. Confirm the real GenX API contract before activation.

## References

[1] [Microsoft Graph: Outlook mail API overview](https://learn.microsoft.com/en-us/graph/outlook-mail-concept-overview)

[2] [Microsoft Graph: Create event API](https://learn.microsoft.com/en-us/graph/api/user-post-events?view=graph-rest-1.0)
