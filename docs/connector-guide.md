# Connected Systems and Browser Sidecar Guide

Amarktai is a **sales operating layer**, not a replacement CRM. Each organisation authorises only the systems and business domains that its members are allowed to use. A saved Connected System is not ready until a backend capability test has completed.

## HubSpot OAuth

Create a HubSpot public app and register the following callback URL, substituting the configured public application URL:

```text
https://your-amarktai-domain.example/api/crm/oauth/callback
```

Set `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET`, `APP_PUBLIC_URL`, and `CONNECTION_SECRETS_MASTER_KEY` on the server. In **Connected Systems**, add HubSpot, select **Connect**, approve the requested least-privilege scopes, and return to Amarktai. The callback exchanges the one-time authorization code, encrypts the resulting token material with AES-256-GCM, runs backend capability checks, and records the result. Only that server verification may transition a system to **Ready**.

> A successful setup card is not proof of a customer CRM connection. The Ready state means the authenticated adapter’s backend test reported the listed verified capabilities. Live production use still requires the organisation’s authorised HubSpot account and deployment configuration.

## Genie and Other Browser CRMs

Add the company’s own CRM URL, then register the organisation-owned hostname and path. Browser systems use a reviewed connector profile: login detector, record patterns, field selectors, deterministic read/write saved scripts, and verification steps. Runtime execution never asks an LLM to rediscover or navigate a CRM page.

Existing Genie flows remain configuration-dependent. The deployment operator must provide an authorised session, calibrate selectors and saved scripts, include screenshot steps when evidence is required, and test every permitted operation. Passwords must not be sent to GenX, tRPC clients, logs, or audit metadata.

## Synchronization and Owner Mapping

A verified system can synchronize companies, contacts, opportunities, tasks, and activities into the organisation-scoped normalized mirror. Sync cursors retain provider progress. Before salesperson queues or manager metrics are meaningful, map each relevant external CRM owner to an Amarktai organisation member. One CRM connection may support many salespeople; do not configure one connection per salesperson.

## Browser Sidecar

The extension source package is in `extension/amarktai-sidecar`. Load it as an unpacked extension only in a controlled pilot browser profile. From **Connected Systems**, issue an eight-hour Sidecar session, paste it once into the extension, and enter the public Amarktai URL. The token is stored hashed server-side and can be revoked from the same page.

The sidecar inspects only the active tab after the Amarktai backend confirms that its hostname and path are an authorised organisation domain. It has no content script, does not attach to every page, and does not receive CRM passwords, OAuth tokens, or server secrets. Record-specific extraction remains unavailable until the selected browser connector’s detector and extractor have been calibrated.

## Recovery

| Situation | Required recovery |
| --- | --- |
| HubSpot token expired or capability test fails | Use **Fix Connection** / **Connect** in Connected Systems, complete OAuth again, and review the new backend test result. |
| Browser CRM session expires | Re-authenticate through the authorised CRM login process, then rerun the server-side test. Do not paste CRM credentials into Amarktai. |
| Sidecar token is lost or browser is no longer trusted | Revoke sidecar sessions, issue a replacement only when needed, and clear the old extension setting. |
| Selector or page layout changes | Pause the browser connector, recalibrate its reviewed saved scripts, test capabilities, and restore readiness only after verification. |

