# Integration Research Notes

## Microsoft Outlook and Calendar

The Outlook integration should be implemented through **Microsoft Graph**. Microsoft documents Outlook as a surface for mail, contacts, scheduling, and related workflow data; the application should request only the permissions required by the enabled feature set.[1]

For calendar scheduling, Graph supports creating events in a user’s default or specified calendar using `POST /me/events` or related user/calendar paths. The documented least-privilege permission for event creation is `Calendars.ReadWrite`; Graph also supports a client-supplied `transactionId` to reduce unnecessary retries.[2]

Microsoft Graph supports webhook subscriptions for Outlook messages, contacts, and events. The production implementation needs a publicly reachable notification endpoint, validation handling, subscription renewal, and recovery logic for missed or removed subscriptions. Use least-privilege read scopes for a subscription and add write scopes only for approved delivery and scheduling actions.[3]

## Genie CRM

The approved generic CRM-browser architecture uses **authorised browser automation rather than an assumed CRM API**. The Webdock installation starts an internal Chromium/CDP service, and the application connects through Playwright using installation-time login configuration and reviewed page selectors. It deliberately has no hard-coded CRM API-key requirement.

The browser bridge follows a **learn once, save script, replay script** approach. A scheduled worker checks the Genie login and dashboard selector every 12 hours. When Genie changes, risky scripts should pause pending a selector repair and reviewed retest; the assistant must not guess a substitute action.

## GenX Model Provider

No authoritative GenX model-provider API reference was located. The application therefore provides a server-side adapter which is intentionally dormant until the deployment receives the exact chat-completions URL, API key, and default model identifier. The adapter expects an OpenAI-style chat-completions response envelope and does not expose any provider credential to the browser. Confirm the real GenX API contract before activation.

## References

[1] [Microsoft Graph: Outlook mail API overview](https://learn.microsoft.com/en-us/graph/outlook-mail-concept-overview)

[2] [Microsoft Graph: Create event API](https://learn.microsoft.com/en-us/graph/api/user-post-events?view=graph-rest-1.0)

[3] [Microsoft Graph: Outlook change notifications](https://learn.microsoft.com/en-us/graph/outlook-change-notifications-overview)
