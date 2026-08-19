# Live Call Intelligence

Amarktai's `/calls` workspace is a desktop-first Live Call Companion. It is intentionally split into replaceable layers so the pilot deployment can use an external transcription service while production can move speech-to-text and realtime media onto dedicated infrastructure without rewriting sales logic.

## Current implemented path

1. An authenticated, second-factor-verified salesperson starts a call session.
2. The browser asks for explicit media permission.
3. The user chooses either microphone-only capture or microphone plus an explicitly shared tab/system-audio source.
4. Browser audio is mixed locally when two sources are selected.
5. `MediaRecorder` produces short audio chunks.
6. `/api/live-calls/transcribe` forwards each chunk to the deployment-controlled `STT_TRANSCRIPTIONS_URL` using an OpenAI-compatible multipart transcription contract.
7. Amarktai stores the returned text against the authorised call session; the bridge does not persist the raw audio chunk.
8. Deterministic code detects common questions, objections, callback requests, commitments and buying signals.
9. GenX coaching is requested only for important signals/questions rather than for every sentence.
10. At call completion the existing post-call flow prepares a reviewable summary.

## Deployment-controlled STT

Required when live transcription is enabled:

```text
STT_TRANSCRIPTIONS_URL=
STT_MODEL=
STT_API_KEY=              # optional when the service does not require one
STT_PROVIDER_LABEL=
```

The application contains no direct OpenAI speech dependency. The endpoint may be an authorised self-hosted/open-source OpenAI-compatible transcription server or another deployment-controlled compatible service.

Suitable open-source candidates to evaluate for production include Speaches/faster-whisper-server and whisper.cpp. Benchmark accuracy, language coverage, latency and concurrency against real telesales recordings before standardising a model.

## Media capture limitations

Browser permissions are deliberately explicit. Browser/OS support for sharing system audio varies. For browser diallers, sharing the actual call tab with audio is preferred. Microphone-only capture is a fallback, not a guarantee that both speakers will be cleanly captured through every headset/softphone combination.

A universal telephony deployment should add a provider-neutral media adapter for SIP/WebRTC/provider streams. LiveKit is an appropriate open-source candidate for that production media layer, but it is not required for the first Webdock pilot and should not be introduced merely to make the service graph larger.

## Privacy and consent

The current UI requires the salesperson to confirm that the organisation authorises transcription/recording assistance and that required participant notice/consent has been handled. This is a product safety control, not legal advice and not a substitute for organisation-specific policy.

Production work should add organisation-level recording/transcription policy, retention settings and jurisdiction-specific workflows before any retained audio-recording feature is enabled. Current chunk transcription does not create a permanent audio recording in Amarktai.

## Cost and token discipline

Speech-to-text cost is separate from GenX reasoning cost. Deterministic signal detection is zero-GenX-credit work. GenX receives short, relevant transcript segments for semantic coaching; it must not receive a continuously growing full-call transcript on every chunk.

Future commercial metering should separately track:

- Amarktai AI Credits;
- call transcription minutes;
- optional retained recording storage.

## Production evolution

The intended scaling path is:

```text
Browser / telephony
        ↓
Realtime media adapter
        ↓
Scalable STT workers
        ↓
Finalised transcript events
        ↓
Deterministic conversation signals
        ↓
Selective GenX reasoning
        ↓
Post-call CRM review bundle
```

The web/API process does not need a GPU. Dedicated transcription/media workers can be added when measured concurrent-call volume requires them.
