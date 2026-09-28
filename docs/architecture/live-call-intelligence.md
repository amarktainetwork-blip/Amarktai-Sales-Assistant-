# Live Call Intelligence

AmarktAI's `/calls` workspace is intentionally salesperson-led. The product does not try to replace the salesperson during a conversation. It prepares context, captures an authorised transcript, stays mostly quiet during the call, helps on demand, and moves summarisation and CRM preparation to the post-call review.

## User workflow

The Calls experience has four states:

1. **Prepare** — choose the customer, review essential CRM context, select the audio source, confirm transcription permission, and start the call.
2. **Live call** — show only compact customer context, the transcript, the salesperson's own notes, and one Sales Assist card. There is no visible signal feed and no AI-generated live structured-notes grid.
3. **Review** — after Stop, AmarktAI analyses the whole transcript together with the salesperson-authored notes and prepares a concise review draft. The salesperson confirms the outcome, callback and next step.
4. **Finish** — prepare the CRM note/activity, task completion, callback, opportunity/status changes and any communication as Review proposals. External CRM/customer-facing actions remain review-only until separately commissioned.

## Current implemented media path

1. An authenticated, second-factor-verified salesperson starts a call session.
2. The browser asks for explicit media permission.
3. The user chooses microphone-only capture or microphone plus explicitly shared browser-call audio.
4. Browser audio is mixed locally when two sources are selected.
5. Web Audio captures mono PCM, applies filtering/compression, suppresses silence, and emits independently decodable 16 kHz WAV chunks on the benchmarked two-second cadence.
6. `/api/live-calls/transcribe` forwards speech chunks to the deployment-controlled transcription service.
7. AmarktAI stores returned transcript text against the authorised call session; raw audio is not retained.
8. Deterministic signals remain **internal only** and are used to decide whether an automatic coaching intervention is worth interrupting the salesperson.
9. Automatic coaching is sparse. The visible Sales Assist card should only help with a factual answer, objection response, or clear next sales move. Routine conversation stays silent.
10. The salesperson can press **Help me** at any time; explicit help takes priority over automatic coaching.
11. The salesperson's own notes are preserved locally during the call and checkpointed with the server when the call stops or the page exits.
12. Stop moves the call to `ready_for_review`. Abandoned sessions are also reconciled to that state by the production worker.
13. Post-call review uses the whole transcript plus salesperson-authored notes. It must not invent speaker identity, commitments, dates, customer intent or outcome.
14. Confirmed closeout produces a factual summary and Review proposals. It never grants authority to write to the CRM or send customer communications automatically.

## Deployment-controlled STT

The production deployment currently supports a default transcription lane plus a fast English lane. Configuration is deployment-controlled; the application contains no direct OpenAI speech dependency.

The live client keeps STT concurrency bounded. Production benchmarking showed the English service serialises concurrent requests, so increasing concurrency would increase latency rather than reduce it. The current two-second chunk cadence is therefore paired with queue/backpressure protection instead of parallel request fan-out.

## Media capture limitations

Browser permissions are explicit. Browser/OS support for sharing system audio varies. For browser diallers, sharing the actual call tab with audio is preferred. Microphone-only capture is appropriate for speakerphone/headset scenarios only when the authorised conversation is actually audible to the selected input.

A future universal telephony layer may use provider-neutral SIP/WebRTC/media streams, but it should be introduced only when real scale or call-source requirements justify it.

## Privacy and consent

The UI requires the salesperson to confirm that the organisation authorises transcription assistance and that required participant notice/consent has been handled. Raw audio chunks are not retained by the Calls pipeline.

Transcript-derived material remains evidence, not authority. Salesperson-authored notes are labelled separately from customer speech. Customer commitments, outcomes, callbacks and CRM changes require explicit salesperson confirmation.

## AI and cost discipline

GenX is not called continuously. Deterministic signal detection is zero-credit trigger logic and is not shown to the salesperson.

Automatic AI intervention should be rare. Explicit **Help me** is always available. Full-call summarisation happens after Stop, when the complete conversation is available, rather than continuously generating speculative live notes.

## Recovery and closeout

- Stop checkpoints the longest known transcript and salesperson notes.
- Page exit sends an emergency checkpoint.
- A stale browser checkpoint cannot overwrite a newer server transcript.
- Reopening a `ready_for_review` call restores transcript, notes and the closeout state.
- The production worker moves abandoned `in_progress` calls to `ready_for_review` without fabricating outcomes.
- Final closeout is idempotent and persists the Review workflow before marking the call completed.
- `autoExecutions` remains empty for live-call closeout until explicitly commissioned write permissions exist.
