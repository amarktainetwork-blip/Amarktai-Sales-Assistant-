# Open-source dependency policy

Amarktai is **open-source first and provider-independent**. Commodity infrastructure should be self-hostable and replaceable where practical. A component is not adopted merely because it is open source; it must have a clear operational role and acceptable licence.

| Component | Current role | Licence / distribution note | Required? | Replacement boundary |
| --- | --- | --- | --- | --- |
| React + Vite | Desktop web client/build | Permissive open-source ecosystem | Required by current product stack | Client can evolve without changing CRM/AI contracts. |
| Express + tRPC | HTTP/API application | MIT | Required by current product stack | Business services remain separate from transport handlers. |
| Drizzle ORM | Typed SQL/schema/migrations | Apache-2.0 | Required by current data layer | Repository/service functions isolate most persistence logic. |
| MariaDB 11.7 | Durable relational system of record | GPLv2 server | Required | SQL data model is kept conventional; managed MariaDB/MySQL-compatible deployment is possible. |
| Valkey 8.1.9 | Redis-protocol cache/coordination foundation | BSD-3-Clause project | Required in Webdock profiles | App keeps `REDIS_URL`; future BullMQ/clients use the protocol rather than Valkey-specific business logic. |
| Chromium | Deterministic browser runtime | Chromium open-source licences/components; installed from Debian packages | Full profile only | Browser connectors use Playwright CDP and can target another authorised CDP runtime. |
| Playwright Core | Browser connector driver | Apache-2.0 | Required for Genie/browser connectors | Browser connector interface remains provider-neutral. |
| Caddy | TLS/reverse proxy | Apache-2.0 | Required in Webdock profiles | Standard HTTP boundary; can be replaced by another reverse proxy. |
| faster-whisper / Speaches-style STT | Candidate self-hosted live-call transcription | Open-source; verify selected image/model licences before production | Optional/configured | `STT_TRANSCRIPTIONS_URL` is an OpenAI-compatible transcription contract. |
| whisper.cpp | Candidate private/local STT | MIT | Optional/future | Same `SpeechToText` deployment boundary. |
| LiveKit | Candidate future realtime/WebRTC/SIP media layer | Apache-2.0 server/agents core; verify optional model licences separately | Future/optional | Media transport must stay outside Amarktai sales/business state. |
| BullMQ | Candidate durable background job framework over Valkey | MIT | Future/optional | Jobs should be idempotent and organisation-scoped regardless of queue implementation. |
| OpenTelemetry | Candidate vendor-neutral tracing/metrics | Apache-2.0 | Future/optional | Instrumentation must never become the business-logic dependency. |

## Browserless

Browserless is **not** the default full deployment. The repository's full Webdock profile builds its own internal Chromium/CDP runtime instead.

The pilot profile deliberately accepts an external CDP endpoint through the historical `BROWSERLESS_WS_ENDPOINT` environment variable for compatibility. That endpoint may be Browserless or another compatible service. If Browserless is selected for a proprietary/commercial deployment, review Browserless's current SSPL/commercial licensing and purchase the required commercial licence where applicable.

## Model licences

Infrastructure licence and model licence are separate questions. Before shipping a self-hosted speech, turn-detection, embedding or other model, record the exact model/version and its licence. Do not make a restricted model irreplaceable in Amarktai's core architecture.
