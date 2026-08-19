# CRM Provider Design Notes

## HubSpot

HubSpot’s current developer-platform OAuth documentation states that integrations installed by multiple HubSpot accounts should use OAuth. The connection flow creates an app, directs the user to HubSpot authorization, receives a `code` at the registered redirect URI, exchanges it at `/oauth/v3/token` using `authorization_code`, and uses the refresh token to obtain a new access token when the access token expires. Scopes must be explicitly configured and should be limited to the required CRM operations. Access tokens may grant broader account access than the installing user’s record-level permissions, so Amarktai must enforce its own organization-level authorization and audit boundary.

Sources:

- https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/oauth/working-with-oauth
- https://developers.hubspot.com/docs/api-reference/legacy/authentication/manage-oauth-tokens
- https://developers.hubspot.com/changelog/v1-oauth-api-deprecation

## Salesforce

Salesforce provides OAuth 2.0 authorization and refresh-token flows for external clients. Its Change Data Capture documentation describes a supported change-event mechanism intended to keep an external system synchronized without repeated bulk exports or continual polling. The adapter design should therefore support event checkpointing and retain incremental-sync fallback behavior.

Sources:

- https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/intro_oauth_and_connected_apps.htm
- https://developer.salesforce.com/docs/atlas.en-us.change_data_capture.meta/change_data_capture/cdc_intro.htm

## Design implications

* Persist encrypted token material separately from connection metadata and never return it from APIs, logs, audit records, or GenX context.
* Do not permit frontend code to set a connection to ready. Capability discovery and a backend verification run must determine readiness.
* Implement provider-neutral normalized records, sync cursors, events, and connection health. Provider APIs and browser automation should be adapters behind the same contract.
* Use provider webhooks/change events where configured and checked, then incremental sync as a fallback.

> These notes document provider capability research only. They do not represent a live customer-authorized connection test.

