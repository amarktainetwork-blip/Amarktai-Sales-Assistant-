import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { friendlyError } from "@/lib/friendlyError";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  CheckCircle2,
  Headphones,
  Mic,
  MonitorUp,
  Square,
  Waves,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type Signal = {
  type: string;
  label: string;
  evidence: string;
  priority: "normal" | "important";
};
type CaptureMode = "microphone" | "mixed";
type TranscriptionResult = {
  text: string;
  signals: Signal[];
  durationMs: number;
  rawAudioRetained: boolean;
};
type CoachingResult = {
  content: string;
  usage?: Record<string, number>;
  actions?: Array<{
    id: number;
    actionType: string;
    title: string;
    state: string;
    autoEligible: boolean;
  }>;
  autoExecutions?: Array<Record<string, unknown>>;
};
type CallContext = {
  connectedSystemId: number;
  provider: string;
  contactExternalId: string;
  contactName: string;
  companyName?: string;
  email?: string;
  phone?: string;
  taskExternalId?: string;
  taskTitle?: string;
  opportunityExternalId?: string;
  opportunityName?: string;
  pipeline?: string;
  stage?: string;
  lastInteraction?: string;
  recentInbound?: string;
  reasons: string[];
  objective?: string;
};

function callError(error: unknown, fallback: string) {
  return friendlyError(error, fallback);
}

function actionStatus(state: string) {
  const normalized = state.toLowerCase();
  if (/executed|completed|succeeded|applied/.test(normalized))
    return "Completed";
  if (/approved/.test(normalized)) return "Approved";
  if (/review/.test(normalized)) return "Ready for review";
  if (/skip|cancel/.test(normalized)) return "Skipped";
  return "Prepared";
}

function blobToBase64(blob: Blob) {
  return blob.arrayBuffer().then(buffer => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000)
      binary += String.fromCharCode(
        ...Array.from(bytes.subarray(offset, offset + 0x8000))
      );
    return btoa(binary);
  });
}

async function postLive<T>(
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok)
    throw new Error(
      result.error || `Live Call Companion request failed (${response.status}).`
    );
  return result;
}

async function getCaptureStream(mode: CaptureMode) {
  const mic = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
    video: false,
  });
  if (mode === "microphone")
    return {
      stream: mic,
      sources: [mic],
      context: undefined as AudioContext | undefined,
    };
  const display = await navigator.mediaDevices.getDisplayMedia({
    audio: true,
    video: true,
  });
  if (!display.getAudioTracks().length) {
    display.getTracks().forEach(track => track.stop());
    mic.getTracks().forEach(track => track.stop());
    throw new Error(
      "No call audio was shared. Select the browser tab with the call and enable Share audio."
    );
  }
  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();
  context.createMediaStreamSource(mic).connect(destination);
  context
    .createMediaStreamSource(new MediaStream(display.getAudioTracks()))
    .connect(destination);
  return { stream: destination.stream, sources: [mic, display], context };
}

export default function LiveCalls() {
  const [leadLabel, setLeadLabel] = useState("");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [captureMode, setCaptureMode] = useState<CaptureMode>("mixed");
  const [consent, setConsent] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [signals, setSignals] = useState<Signal[]>([]);
  const [tip, setTip] = useState("");
  const [sttReady, setSttReady] = useState<boolean | null>(null);
  const [completing, setCompleting] = useState(false);
  const [awaitingCloseout, setAwaitingCloseout] = useState(false);
  const [outcome, setOutcome] = useState("interested");
  const [nextStep, setNextStep] = useState("");
  const [callbackAt, setCallbackAt] = useState("");
  const [taskExternalId, setTaskExternalId] = useState("");
  const [contactExternalId, setContactExternalId] = useState("");
  const [opportunityExternalId, setOpportunityExternalId] = useState("");
  const [selectedContactId, setSelectedContactId] = useState<
    number | undefined
  >();
  const [communicationChannel, setCommunicationChannel] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [closeoutActions, setCloseoutActions] = useState<
    CoachingResult["actions"]
  >([]);
  const [workflowError, setWorkflowError] = useState("");
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const sourcesRef = useRef<MediaStream[]>([]);
  const audioContextRef = useRef<AudioContext | undefined>(undefined);
  const pendingRef = useRef<Promise<void>>(Promise.resolve());
  const transcriptRef = useRef("");
  const lastCoachAtRef = useRef(0);
  const coachingRef = useRef(false);

  const startSession = trpc.calls.startLive.useMutation();
  const initialSessionId = Number(
    new URLSearchParams(window.location.search).get("sessionId") || 0
  );
  const initialContactId = Number(
    new URLSearchParams(window.location.search).get("contactId") || 0
  );
  const initialCustomers = trpc.sales.customers.useQuery(undefined, {
    enabled: initialContactId > 0,
    retry: false,
  });
  const callContext = trpc.calls.context.useQuery(
    { callSessionId: sessionId || initialSessionId },
    { enabled: Boolean(sessionId || initialSessionId), retry: false }
  );
  const contactMatches = trpc.calls.searchContacts.useQuery(
    { query: leadLabel.trim() || "--" },
    { enabled: !sessionId && leadLabel.trim().length >= 2, retry: false }
  );

  useEffect(() => {
    if (initialSessionId > 0 && !sessionId) setSessionId(initialSessionId);
  }, [initialSessionId, sessionId]);

  useEffect(() => {
    if (initialContactId <= 0 || selectedContactId) return;
    const contact = initialCustomers.data?.find(
      item => item.id === initialContactId
    );
    if (!contact) return;
    setSelectedContactId(contact.id);
    setLeadLabel(contact.name);
  }, [initialContactId, initialCustomers.data, selectedContactId]);

  useEffect(() => {
    if (!callContext.data) return;
    setLeadLabel(callContext.data.leadLabel);
    const context = callContext.data.context as CallContext | undefined;
    setContactExternalId(context?.contactExternalId || "");
    setTaskExternalId(context?.taskExternalId || "");
    setOpportunityExternalId(context?.opportunityExternalId || "");
  }, [callContext.data]);

  useEffect(() => {
    if (contactMatches.data?.length === 1)
      setSelectedContactId(contactMatches.data[0].id);
    else if (
      !contactMatches.data?.some(contact => contact.id === selectedContactId)
    )
      setSelectedContactId(undefined);
  }, [contactMatches.data, selectedContactId]);

  useEffect(() => {
    fetch("/api/live-calls/readiness", { credentials: "include" })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(
            body.error || "Could not check transcription readiness."
          );
        setSttReady(Boolean(body.ready));
      })
      .catch(error => {
        setSttReady(false);
        setWorkflowError(
          callError(
            error,
            "Live transcription could not be checked. You can reload the call companion and try again."
          )
        );
        setRetryAction(() => () => window.location.reload());
      });

    return () => {
      if (recorderRef.current && recorderRef.current.state !== "inactive")
        recorderRef.current.stop();
      sourcesRef.current.forEach(stream =>
        stream.getTracks().forEach(track => track.stop())
      );
      void audioContextRef.current?.close();
    };
  }, []);

  async function requestCoaching(activeSessionId: number, text: string) {
    if (coachingRef.current) return;
    coachingRef.current = true;
    try {
      const result = await postLive<CoachingResult>("/api/live-calls/coach", {
        callSessionId: activeSessionId,
        leadLabel,
        transcriptChunk: text,
      });
      setTip(result.content);
    } catch (error) {
      setWorkflowError(
        callError(
          error,
          "Live coaching is temporarily unavailable. Your call notes are still safe."
        )
      );
      setRetryAction(() => () => void requestCoaching(activeSessionId, text));
    } finally {
      coachingRef.current = false;
    }
  }

  async function uploadChunk(blob: Blob, activeSessionId: number) {
    if (!blob.size) return;
    const base64 = await blobToBase64(blob);
    const mimeType = (blob.type || "audio/webm").split(";")[0];
    const result = await postLive<TranscriptionResult>(
      "/api/live-calls/transcribe",
      {
        callSessionId: activeSessionId,
        audioBase64: base64,
        mimeType,
        durationMs: 5000,
      }
    );
    const text = result.text?.trim();
    if (!text) return;
    transcriptRef.current =
      `${transcriptRef.current}${transcriptRef.current ? "\n" : ""}${text}`.slice(
        -40_000
      );
    setTranscript(transcriptRef.current);
    if (result.signals?.length) {
      setSignals(current =>
        [...result.signals, ...current]
          .filter(
            (signal, index, all) =>
              all.findIndex(
                other =>
                  other.type === signal.type &&
                  other.evidence === signal.evidence
              ) === index
          )
          .slice(0, 12)
      );
      const needsCoach = result.signals.some(
        signal => signal.priority === "important" || signal.type === "question"
      );
      if (
        needsCoach &&
        Date.now() - lastCoachAtRef.current > 15_000 &&
        !coachingRef.current
      ) {
        lastCoachAtRef.current = Date.now();
        void requestCoaching(activeSessionId, text);
      }
    }
  }

  async function begin() {
    if (!leadLabel.trim())
      return toast.error("Choose the customer before starting.");
    if (!consent)
      return toast.error(
        "Confirm that your organisation allows transcription assistance for this call."
      );
    if (!sttReady)
      return toast.error(
        "Live transcription isn't available right now. You can still record a no-answer or voicemail outcome."
      );

    try {
      const started = sessionId
        ? undefined
        : await startSession.mutateAsync({
            leadLabel: leadLabel.trim(),
            contactId: selectedContactId,
          });
      const activeSessionId = sessionId ?? started!.callSessionId;
      if (started?.leadLabel) setLeadLabel(started.leadLabel);
      setSessionId(activeSessionId);
      const capture = await getCaptureStream(captureMode);
      sourcesRef.current = capture.sources;
      audioContextRef.current = capture.context;
      const preferred = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "";
      const recorder = preferred
        ? new MediaRecorder(capture.stream, {
            mimeType: preferred,
            audioBitsPerSecond: 64000,
          })
        : new MediaRecorder(capture.stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = event => {
        if (!event.data.size) return;
        pendingRef.current = pendingRef.current
          .then(() => uploadChunk(event.data, activeSessionId))
          .catch(error => {
            const detail = callError(
              error,
              "Live transcription was interrupted. Your existing call notes are still available."
            );
            setWorkflowError(detail);
            setRetryAction(
              () => () => void uploadChunk(event.data, activeSessionId)
            );
            toast.error(detail);
          });
      };
      recorder.start(5000);
      setRecording(true);
      toast.success(
        captureMode === "mixed"
          ? "Live Call Companion started. Keep the call tab audio shared."
          : "Microphone transcription started."
      );
    } catch (error) {
      sourcesRef.current.forEach(stream =>
        stream.getTracks().forEach(track => track.stop())
      );
      sourcesRef.current = [];
      void audioContextRef.current?.close();
      audioContextRef.current = undefined;
      const detail = callError(
        error,
        "The call companion could not start. Check microphone and browser permissions, then try again."
      );
      setWorkflowError(detail);
      setRetryAction(() => () => void begin());
      toast.error(detail);
    }
  }

  async function stop() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    await new Promise<void>(resolve => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
      recorder.stop();
    });
    setRecording(false);
    sourcesRef.current.forEach(stream =>
      stream.getTracks().forEach(track => track.stop())
    );
    sourcesRef.current = [];
    await audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = undefined;
    await pendingRef.current;
    if (sessionId) setAwaitingCloseout(true);
  }

  async function recordAttemptWithoutAudio() {
    try {
      const started = sessionId
        ? undefined
        : await startSession.mutateAsync({
            leadLabel: leadLabel.trim(),
            contactId: selectedContactId,
          });
      const activeSessionId = sessionId ?? started!.callSessionId;
      setSessionId(activeSessionId);
      if (started?.leadLabel) setLeadLabel(started.leadLabel);
      setOutcome("no_answer");
      setAwaitingCloseout(true);
    } catch (error) {
      const detail = callError(
        error,
        "The call attempt could not be opened. Nothing was changed."
      );
      setWorkflowError(detail);
      setRetryAction(() => () => void recordAttemptWithoutAudio());
      toast.error(detail);
    }
  }

  async function completeCloseout() {
    if (!sessionId || !awaitingCloseout) return;
    if (communicationChannel && !templateName.trim())
      return toast.error(
        "Choose the approved communication template before preparing a follow-up."
      );
    setCompleting(true);
    try {
      const result = await postLive<CoachingResult>(
        "/api/live-calls/complete",
        {
          callSessionId: sessionId,
          leadLabel,
          transcript: transcriptRef.current,
          outcome,
          nextStep: nextStep.trim() || undefined,
          callbackAt: callbackAt
            ? new Date(callbackAt).toISOString()
            : undefined,
          opportunityState:
            outcome === "sale_won"
              ? "won"
              : outcome === "lost"
                ? "lost"
                : "unchanged",
          contactStatus: [
            "qualified",
            "unqualified",
            "not_interested",
            "wrong_number",
          ].includes(outcome)
            ? outcome
            : undefined,
          commitmentsConfirmed: true,
          contactExternalId: contactExternalId.trim() || undefined,
          taskExternalId: taskExternalId.trim() || undefined,
          opportunityExternalId: opportunityExternalId.trim() || undefined,
          communication: communicationChannel
            ? {
                channel: communicationChannel,
                templateName: templateName.trim(),
              }
            : undefined,
        }
      );
      setTip(result.content);
      setCloseoutActions(result.actions || []);
      setAwaitingCloseout(false);
      const completed = result.autoExecutions?.length || 0;
      toast.success(
        completed
          ? `Follow-up prepared. ${completed} already-approved ${completed === 1 ? "item was" : "items were"} completed; anything else is ready for review.`
          : "Follow-up prepared. Any CRM changes that need approval are ready for review."
      );
    } catch (error) {
      const detail = callError(
        error,
        "The follow-up could not be prepared. Nothing new was sent or changed."
      );
      setWorkflowError(detail);
      setRetryAction(() => () => void completeCloseout());
      toast.error(detail);
    } finally {
      setCompleting(false);
    }
  }

  return (
    <DashboardLayout>
      <div data-call-workflow className="text-[#26354A]">
        <header className="border-b border-[#DCE4EE] pb-6">
          <p className="text-[10px] font-black uppercase tracking-[.16em] text-[#2F6FED]">
            AMARKTAI / LIVE CALL COMPANION
          </p>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-[-.06em] text-[#203047] sm:text-5xl">
            Listen less to the admin. Listen more to the customer.
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[#66758A]">
            With your permission, AmarktAI can transcribe the call, notice
            important questions and commitments, and offer coaching when it is
            useful. You stay in control of what is saved or sent.
          </p>
        </header>

        {workflowError ? (
          <section
            role="alert"
            className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-900"
          >
            <p className="font-bold">The current call step needs attention.</p>
            <p className="mt-2 text-sm leading-6 text-rose-700">
              {workflowError}
            </p>
            <div className="mt-4 flex gap-2">
              {retryAction ? (
                <Button onClick={retryAction} className="bg-[#2F6FED] hover:bg-[#2459C2]">
                  Retry
                </Button>
              ) : null}
              <Button
                variant="outline"
                onClick={() => setWorkflowError("")}
                className="border-[#D7E0EA] bg-white text-[#52647A] hover:bg-[#F5F8FC]"
              >
                Dismiss
              </Button>
            </div>
          </section>
        ) : null}

        {callContext.data?.context && (
          <section className="mt-6 rounded-[1.5rem] border border-[#DCE4EE] bg-white p-6">
            <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#2F6FED]">
              PRE-CALL BRIEF
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              {[
                [
                  "Customer",
                  `${callContext.data.context.contactName}${callContext.data.context.companyName ? ` · ${callContext.data.context.companyName}` : ""}\n${callContext.data.context.phone || callContext.data.context.email || "No phone or email available"}`,
                ],
                [
                  "Opportunity",
                  `${callContext.data.context.pipeline || "No pipeline"} / ${callContext.data.context.stage || "No stage"}\n${callContext.data.context.opportunityName || "No open opportunity"}`,
                ],
                [
                  "Current work",
                  callContext.data.context.taskTitle || "No current task",
                ],
                [
                  "Recent history",
                  callContext.data.context.recentInbound ||
                    callContext.data.context.lastInteraction ||
                    "No recent interaction",
                ],
                [
                  "Why call now / objective",
                  `${callContext.data.context.reasons.join(" · ") || "Selected customer"}\n${callContext.data.context.objective || "Confirm the next factual step"}`,
                ],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-[#E5EAF0] bg-[#F8FAFC] p-4">
                  <p className="text-[10px] font-black uppercase text-[#728197]">
                    {label}
                  </p>
                  <p className="mt-2 whitespace-pre-line text-sm leading-6 text-[#33445B]">
                    {value}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="mt-6 grid gap-6 xl:grid-cols-[1.05fr_.95fr]">
          <section className="rounded-[1.5rem] border border-[#DCE4EE] bg-white p-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-[#EAF1FF] text-[#2F6FED]">
                  <Headphones size={19} />
                </span>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#2F6FED]">
                    CALL AUDIO
                  </p>
                  <h2 className="font-display text-2xl font-bold tracking-[-.05em] text-[#26354A]">
                    Live session
                  </h2>
                </div>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-bold ${sttReady ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
              >
                {sttReady === null
                  ? "Checking transcription…"
                  : sttReady
                    ? "Transcription ready"
                    : "Transcription unavailable"}
              </span>
            </div>

            <label className="mt-6 block text-xs font-black uppercase tracking-[.12em] text-[#66758A]">
              Customer / contact
            </label>
            <Input
              aria-label="Customer"
              disabled={recording}
              value={leadLabel}
              onChange={event => {
                setLeadLabel(event.target.value);
                setSelectedContactId(undefined);
              }}
              placeholder="Jane Smith, email, or phone"
              className="mt-2 border-[#CBD5E0] bg-white text-[#26354A] placeholder:text-[#95A2B2]"
            />

            {!sessionId && !!contactMatches.data?.length && (
              <div className="mt-2 space-y-1 rounded-xl border border-[#DCE4EE] bg-white p-2 shadow-sm">
                <p className="px-2 py-1 text-[10px] font-black uppercase text-[#728197]">
                  Choose the customer
                </p>
                {contactMatches.data.map(contact => (
                  <button
                    key={contact.id}
                    type="button"
                    onClick={() => {
                      setSelectedContactId(contact.id);
                      setLeadLabel(contact.name);
                    }}
                    className={`block w-full rounded-lg px-3 py-2 text-left text-xs ${selectedContactId === contact.id ? "bg-[#EAF1FF] text-[#2459C2]" : "text-[#52647A] hover:bg-[#F2F5F8]"}`}
                  >
                    <b>{contact.name}</b>
                    <span className="ml-2 text-[#7B8798]">
                      {contact.email || contact.phone || "Customer"}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <button
                disabled={recording}
                onClick={() => setCaptureMode("mixed")}
                className={`rounded-xl border p-4 text-left transition ${captureMode === "mixed" ? "border-[#2F6FED] bg-[#EAF1FF]" : "border-[#DCE4EE] bg-[#F8FAFC] hover:border-[#B9C7D8]"}`}
              >
                <MonitorUp className="size-5 text-[#2F6FED]" />
                <p className="mt-3 font-bold text-[#26354A]">
                  Call audio + microphone
                </p>
                <p className="mt-1 text-xs leading-5 text-[#66758A]">
                  Best for browser calls. Select the call tab and share its
                  audio; AmarktAI combines it with your microphone.
                </p>
              </button>
              <button
                disabled={recording}
                onClick={() => setCaptureMode("microphone")}
                className={`rounded-xl border p-4 text-left transition ${captureMode === "microphone" ? "border-[#2F6FED] bg-[#EAF1FF]" : "border-[#DCE4EE] bg-[#F8FAFC] hover:border-[#B9C7D8]"}`}
              >
                <Mic className="size-5 text-[#2F6FED]" />
                <p className="mt-3 font-bold text-[#26354A]">Microphone only</p>
                <p className="mt-1 text-xs leading-5 text-[#66758A]">
                  Use this for speakerphone or headset calls where your
                  microphone can capture the authorised conversation.
                </p>
              </button>
            </div>

            <label className="mt-5 flex cursor-pointer gap-3 rounded-xl border border-[#DCE4EE] bg-[#F8FAFC] p-4 text-sm leading-6 text-[#52647A]">
              <input
                type="checkbox"
                checked={consent}
                disabled={recording}
                onChange={event => setConsent(event.target.checked)}
                className="mt-1 size-4"
              />
              <span>
                I confirm that my organisation allows transcription assistance
                for this call and that any required participant notice or
                consent has been handled.
              </span>
            </label>

            <div className="mt-5 flex flex-wrap gap-3">
              {!recording ? (
                <Button
                  disabled={
                    !leadLabel.trim() ||
                    !consent ||
                    !sttReady ||
                    (!!contactMatches.data &&
                      contactMatches.data.length > 1 &&
                      !selectedContactId) ||
                    startSession.isPending ||
                    completing
                  }
                  onClick={() => void begin()}
                  className="h-12 bg-[#2F6FED] hover:bg-[#2459C2]"
                >
                  <Waves className="mr-2 size-4" />
                  Start Live Companion
                </Button>
              ) : (
                <Button
                  onClick={() => void stop()}
                  className="h-12 bg-rose-600 hover:bg-rose-500"
                >
                  <Square className="mr-2 size-4" />
                  Stop & prepare follow-up
                </Button>
              )}
              {!recording && (
                <Button
                  variant="outline"
                  disabled={
                    !leadLabel.trim() ||
                    startSession.isPending ||
                    (!!contactMatches.data &&
                      contactMatches.data.length > 1 &&
                      !selectedContactId)
                  }
                  onClick={() => void recordAttemptWithoutAudio()}
                  className="h-12 border-[#D7E0EA] bg-white text-[#52647A] hover:bg-[#F5F8FC]"
                >
                  Record no-answer / voicemail
                </Button>
              )}
              {recording && (
                <span className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-4 text-sm font-bold text-emerald-700">
                  <span className="size-2 animate-pulse rounded-full bg-emerald-500" />
                  Listening
                </span>
              )}
              {completing && (
                <span className="inline-flex items-center rounded-xl bg-[#F2F5F8] px-4 text-sm font-bold text-[#52647A]">
                  Preparing follow-up…
                </span>
              )}
            </div>

            <div className="mt-6 min-h-48 rounded-xl border border-[#DCE4EE] bg-[#F8FAFC] p-4">
              <p className="text-[10px] font-black uppercase tracking-[.13em] text-[#2F6FED]">
                LIVE TRANSCRIPT
              </p>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[#33445B]">
                {transcript ||
                  "Call notes will appear here while the conversation is running."}
              </p>
            </div>

            {awaitingCloseout && (
              <section className="mt-5 rounded-xl border border-[#DCE4EE] bg-[#F8FAFC] p-5">
                <p className="text-[10px] font-black uppercase tracking-[.13em] text-[#2F6FED]">
                  CALL OUTCOME
                </p>
                <h3 className="mt-2 font-display text-2xl font-bold text-[#26354A]">
                  Confirm what happened and prepare the next step.
                </h3>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="grid gap-2 text-xs font-bold text-[#66758A]">
                    Outcome
                    <select
                      value={outcome}
                      onChange={event => setOutcome(event.target.value)}
                      className="h-10 rounded-xl border border-[#CBD5E0] bg-white px-3 text-[#26354A]"
                    >
                      <option value="interested">Interested</option>
                      <option value="information_requested">
                        Information requested
                      </option>
                      <option value="callback">Callback requested</option>
                      <option value="meeting_booked">Meeting booked</option>
                      <option value="no_answer">No answer</option>
                      <option value="voicemail">Voicemail</option>
                      <option value="wrong_number">Wrong number</option>
                      <option value="not_interested">Not interested</option>
                      <option value="qualified">Qualified</option>
                      <option value="unqualified">Unqualified</option>
                      <option value="sale_won">Sale / won</option>
                      <option value="lost">Lost</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <label className="grid gap-2 text-xs font-bold text-[#66758A]">
                    Callback date/time
                    <Input
                      type="datetime-local"
                      value={callbackAt}
                      onChange={event => setCallbackAt(event.target.value)}
                      className="border-[#CBD5E0] bg-white text-[#26354A]"
                    />
                  </label>
                  <label className="grid gap-2 text-xs font-bold text-[#66758A] md:col-span-2">
                    Next step
                    <Input
                      value={nextStep}
                      onChange={event => setNextStep(event.target.value)}
                      placeholder="Send product information"
                      className="border-[#CBD5E0] bg-white text-[#26354A]"
                    />
                  </label>
                  <label className="grid gap-2 text-xs font-bold text-[#66758A]">
                    Follow-up
                    <select
                      value={communicationChannel}
                      onChange={event =>
                        setCommunicationChannel(event.target.value)
                      }
                      className="h-10 rounded-xl border border-[#CBD5E0] bg-white px-3 text-[#26354A]"
                    >
                      <option value="">None</option>
                      <option value="email">Email template</option>
                      <option value="sms">SMS template</option>
                      <option value="whatsapp">WhatsApp template</option>
                    </select>
                  </label>
                  <label className="grid gap-2 text-xs font-bold text-[#66758A]">
                    Template name
                    <Input
                      disabled={!communicationChannel}
                      value={templateName}
                      onChange={event => setTemplateName(event.target.value)}
                      placeholder="Product brochure"
                      className="border-[#CBD5E0] bg-white text-[#26354A]"
                    />
                  </label>
                </div>
                <div className="mt-4 rounded-xl bg-[#EAF1FF] p-3 text-xs leading-5 text-[#35547A]">
                  {callContext.data?.context
                    ? "This call is linked to the selected customer. "
                    : "Choose a customer before preparing customer updates. "}
                  AmarktAI will prepare a factual note and call activity
                  {taskExternalId ? " + complete the current task" : ""}
                  {callbackAt ? " + create a callback" : ""}
                  {communicationChannel
                    ? ` + prepare a ${communicationChannel} template for your review`
                    : ""}
                  . You can review any external change before it is made.
                </div>
                <Button
                  disabled={completing}
                  onClick={() => void completeCloseout()}
                  className="mt-4 bg-[#2F6FED] hover:bg-[#2459C2]"
                >
                  {completing
                    ? "Preparing follow-up…"
                    : "Confirm outcome and prepare follow-up"}
                </Button>
              </section>
            )}

            {!!closeoutActions?.length && (
              <section className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
                <p className="text-[10px] font-black uppercase tracking-[.13em] text-emerald-700">
                  FOLLOW-UP
                </p>
                <div className="mt-3 space-y-2">
                  {closeoutActions.map(action => (
                    <div
                      key={action.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-emerald-100 bg-white p-3"
                    >
                      <span className="text-sm font-semibold text-[#26354A]">
                        {action.title}
                      </span>
                      <span className="text-[10px] font-black uppercase text-emerald-700">
                        {actionStatus(action.state)}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </section>

          <div className="grid gap-6">
            <section className="rounded-[1.5rem] border border-[#DCE4EE] bg-white p-6">
              <div className="flex items-center gap-3">
                <AlertTriangle className="size-5 text-[#2F6FED]" />
                <h2 className="font-display text-2xl font-bold tracking-[-.05em] text-[#26354A]">
                  Live signals
                </h2>
              </div>
              <div className="mt-4 space-y-3">
                {signals.length ? (
                  signals.map((signal, index) => (
                    <article
                      key={`${signal.type}-${index}`}
                      className={`rounded-xl border p-4 ${signal.priority === "important" ? "border-[#B7CCF7] bg-[#EAF1FF]" : "border-[#DCE4EE] bg-[#F8FAFC]"}`}
                    >
                      <p className="text-xs font-black uppercase tracking-[.1em] text-[#2F6FED]">
                        {signal.label}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-[#33445B]">
                        {signal.evidence}
                      </p>
                    </article>
                  ))
                ) : (
                  <p className="text-sm leading-6 text-[#66758A]">
                    Questions, objections, commitments, callback requests and
                    buying signals noticed during the call will appear here.
                  </p>
                )}
              </div>
            </section>

            <section className="rounded-[1.5rem] border border-[#DCE4EE] bg-white p-6">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="size-5 text-[#2F6FED]" />
                <h2 className="font-display text-2xl font-bold tracking-[-.05em] text-[#26354A]">
                  Current coaching
                </h2>
              </div>
              <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-[#33445B]">
                {tip ||
                  "Coaching appears when an important question or signal needs help. Routine transcription stays focused on accurate notes."}
              </p>
            </section>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
