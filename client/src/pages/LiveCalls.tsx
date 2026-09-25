import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { friendlyError } from "@/lib/friendlyError";
import { trpc } from "@/lib/trpc";
import {
  emptyLiveStructuredNotes,
  mergeLiveStructuredNotes,
  type LiveStructuredNotes,
} from "@shared/liveCallNotes";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Headphones,
  Mic,
  MonitorUp,
  Square,
  Waves,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

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
  structuredNotes: LiveStructuredNotes;
  durationMs: number;
  rawAudioRetained: boolean;
};

const LIVE_AUDIO_CHUNK_MS = 2_500;
const LIVE_COACH_INTERVAL_MS = 5_000;
const LIVE_COACH_STALE_MS = 9_000;
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

function encodePcmWav(samples: Float32Array, sampleRate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++)
      view.setUint8(offset + i, value.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let index = 0; index < samples.length; index++) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(
      offset,
      clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
      true
    );
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
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

async function streamLiveCoach(
  body: Record<string, unknown>,
  signal: AbortSignal,
  onDelta: (content: string) => void
) {
  const response = await fetch("/api/live-calls/coach-stream", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      result.error || `Live coaching request failed (${response.status}).`
    );
  }
  if (!response.body) throw new Error("Live coaching stream is unavailable.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let partial = "";
  let finalContent = "";

  const consumeEvent = (raw: string) => {
    let event = "message";
    let data = "";
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data) return;
    const payload = JSON.parse(data) as {
      delta?: string;
      content?: string;
      error?: string;
    };
    if (event === "delta" && payload.delta) {
      partial += payload.delta;
      onDelta(partial);
    } else if (event === "done") {
      finalContent = payload.content || partial;
      if (finalContent) onDelta(finalContent);
    } else if (event === "error") {
      throw new Error(payload.error || "Live coaching stream failed.");
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      consumeEvent(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) consumeEvent(buffer);
  return finalContent || partial;
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
  const [, navigate] = useLocation();
  const initialSessionId = Number(
    new URLSearchParams(window.location.search).get("sessionId") || 0
  );
  const initialContactId = Number(
    new URLSearchParams(window.location.search).get("contactId") || 0
  );
  const [leadLabel, setLeadLabel] = useState("");
  const [sessionId, setSessionId] = useState<number | null>(
    initialSessionId > 0 ? initialSessionId : null
  );
  const [captureMode, setCaptureMode] = useState<CaptureMode>("mixed");
  const [consent, setConsent] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [signals, setSignals] = useState<Signal[]>([]);
  const [structuredNotes, setStructuredNotes] = useState<LiveStructuredNotes>(
    emptyLiveStructuredNotes
  );
  const [tip, setTip] = useState("");
  const [sttReady, setSttReady] = useState<boolean | null>(null);
  const [completing, setCompleting] = useState(false);
  const [awaitingCloseout, setAwaitingCloseout] = useState(false);
  const [outcome, setOutcome] = useState("interested");
  const [nextStep, setNextStep] = useState("");
  const [callbackAt, setCallbackAt] = useState("");
  const [closeoutConfirmed, setCloseoutConfirmed] = useState(false);
  const [taskExternalId, setTaskExternalId] = useState("");
  const [contactExternalId, setContactExternalId] = useState("");
  const [opportunityExternalId, setOpportunityExternalId] = useState("");
  const [selectedContactId, setSelectedContactId] = useState<
    number | undefined
  >(initialContactId > 0 ? initialContactId : undefined);
  const [communicationChannel, setCommunicationChannel] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [closeoutActions, setCloseoutActions] = useState<
    CoachingResult["actions"]
  >([]);
  const [workflowError, setWorkflowError] = useState("");
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingRef = useRef(false);
  const chunkTimerRef = useRef<number | undefined>(undefined);
  const sourcesRef = useRef<MediaStream[]>([]);
  const audioContextRef = useRef<AudioContext | undefined>(undefined);
  const pendingRef = useRef<Promise<void>>(Promise.resolve());
  const transcriptRef = useRef("");
  const lastCoachAtRef = useRef(0);
  const coachingRef = useRef(false);
  const coachAbortRef = useRef<AbortController | null>(null);
  const coachStartedAtRef = useRef(0);
  const pendingCoachRef = useRef<{
    activeSessionId: number;
    text: string;
  } | null>(null);
  const coachTimerRef = useRef<number | undefined>(undefined);

  const startSession = trpc.calls.startLive.useMutation();
  const initialSelectionApplied = useRef(0);
  const initialCustomer = trpc.sales.customerDetail.useQuery(
    { contactId: selectedContactId || initialContactId || 1 },
    {
      enabled: Boolean(selectedContactId || initialContactId > 0),
      retry: false,
    }
  );
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
    if (
      initialContactId <= 0 ||
      initialSelectionApplied.current === initialContactId
    )
      return;
    const contact = initialCustomer.data;
    if (!contact) return;
    initialSelectionApplied.current = initialContactId;
    setSelectedContactId(contact.id);
    setLeadLabel(contact.name);
    setContactExternalId(contact.externalId);
    setTaskExternalId(contact.nextAction?.externalId || "");
    setOpportunityExternalId(contact.openOpportunity?.externalId || "");
  }, [initialContactId, initialCustomer.data, selectedContactId]);

  useEffect(() => {
    if (!callContext.data) return;
    setLeadLabel(callContext.data.leadLabel);
    const context = callContext.data.context as CallContext | undefined;
    setContactExternalId(context?.contactExternalId || "");
    setTaskExternalId(context?.taskExternalId || "");
    setOpportunityExternalId(context?.opportunityExternalId || "");
  }, [callContext.data]);

  useEffect(() => {
    if (!contactMatches.data || selectedContactId) return;
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
      recordingRef.current = false;
      if (chunkTimerRef.current !== undefined)
        window.clearTimeout(chunkTimerRef.current);
      if (coachTimerRef.current !== undefined)
        window.clearTimeout(coachTimerRef.current);
      coachAbortRef.current?.abort();
      coachAbortRef.current = null;
      pendingCoachRef.current = null;
      if (recorderRef.current && recorderRef.current.state !== "inactive")
        recorderRef.current.stop();
      sourcesRef.current.forEach(stream =>
        stream.getTracks().forEach(track => track.stop())
      );
      void audioContextRef.current?.close();
    };
  }, []);

  async function requestCoaching(activeSessionId: number, text: string) {
    if (coachingRef.current) {
      pendingCoachRef.current = { activeSessionId, text };
      if (Date.now() - coachStartedAtRef.current > LIVE_COACH_STALE_MS)
        coachAbortRef.current?.abort();
      return;
    }
    const controller = new AbortController();
    coachingRef.current = true;
    coachAbortRef.current = controller;
    coachStartedAtRef.current = Date.now();
    try {
      const content = await streamLiveCoach(
        {
          callSessionId: activeSessionId,
          leadLabel,
          transcriptChunk: text,
        },
        controller.signal,
        partial => {
          if (!controller.signal.aborted) setTip(partial);
        }
      );
      if (!controller.signal.aborted && content) {
        lastCoachAtRef.current = Date.now();
        setTip(content);
        setWorkflowError("");
        setRetryAction(null);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setWorkflowError(
        callError(
          error,
          "Live coaching is temporarily unavailable. Your transcript and live notes are still safe."
        )
      );
      setRetryAction(() => () => void requestCoaching(activeSessionId, text));
    } finally {
      if (coachAbortRef.current === controller) coachAbortRef.current = null;
      coachingRef.current = false;
      const pending = pendingCoachRef.current;
      pendingCoachRef.current = null;
      if (pending) scheduleCoaching(pending.activeSessionId, pending.text);
    }
  }

  function scheduleCoaching(activeSessionId: number, text: string) {
    pendingCoachRef.current = { activeSessionId, text };
    if (coachingRef.current) {
      if (Date.now() - coachStartedAtRef.current > LIVE_COACH_STALE_MS)
        coachAbortRef.current?.abort();
      return;
    }
    if (coachTimerRef.current !== undefined) return;
    const delay = Math.max(
      0,
      LIVE_COACH_INTERVAL_MS - (Date.now() - lastCoachAtRef.current)
    );
    coachTimerRef.current = window.setTimeout(() => {
      coachTimerRef.current = undefined;
      const pending = pendingCoachRef.current;
      pendingCoachRef.current = null;
      if (pending) void requestCoaching(pending.activeSessionId, pending.text);
    }, delay);
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
        durationMs: LIVE_AUDIO_CHUNK_MS,
      }
    );
    setStructuredNotes(current =>
      mergeLiveStructuredNotes(
        current,
        result.structuredNotes || emptyLiveStructuredNotes()
      )
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
      if (needsCoach)
        scheduleCoaching(activeSessionId, transcriptRef.current.slice(-8_000));
    }
  }

  function startRecordingCycle(stream: MediaStream, activeSessionId: number) {
    const context = audioContextRef.current || new AudioContext();
    audioContextRef.current = context;
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const sink = context.createGain();
    sink.gain.value = 0;
    const samples: number[] = [];
    let lastFlushAt = performance.now();

    const flush = () => {
      if (!samples.length) return;
      const blob = encodePcmWav(
        Float32Array.from(samples.splice(0)),
        context.sampleRate
      );
      pendingRef.current = pendingRef.current
        .then(() => uploadChunk(blob, activeSessionId))
        .catch(error => {
          const detail = callError(
            error,
            "Live transcription was interrupted. Your existing call notes are still available."
          );
          setWorkflowError(detail);
          setRetryAction(() => () => void uploadChunk(blob, activeSessionId));
          toast.error(detail);
        });
    };

    processor.onaudioprocess = event => {
      if (!recordingRef.current) return;
      const input = event.inputBuffer.getChannelData(0);
      for (let index = 0; index < input.length; index++)
        samples.push(input[index]);
      if (performance.now() - lastFlushAt >= LIVE_AUDIO_CHUNK_MS) {
        lastFlushAt = performance.now();
        flush();
      }
    };
    source.connect(processor);
    processor.connect(sink);
    sink.connect(context.destination);
    recorderRef.current = null;
    chunkTimerRef.current = window.setInterval(() => {
      if (
        recordingRef.current &&
        performance.now() - lastFlushAt >= LIVE_AUDIO_CHUNK_MS
      ) {
        lastFlushAt = performance.now();
        flush();
      }
    }, 250);
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
      if (started) {
        transcriptRef.current = "";
        coachAbortRef.current?.abort();
        coachAbortRef.current = null;
        pendingCoachRef.current = null;
        lastCoachAtRef.current = 0;
        if (coachTimerRef.current !== undefined) {
          window.clearTimeout(coachTimerRef.current);
          coachTimerRef.current = undefined;
        }
        setTranscript("");
        setSignals([]);
        setStructuredNotes(emptyLiveStructuredNotes());
        setTip("");
      }
      if (started?.leadLabel) setLeadLabel(started.leadLabel);
      setSessionId(activeSessionId);
      const capture = await getCaptureStream(captureMode);
      sourcesRef.current = capture.sources;
      audioContextRef.current = capture.context || new AudioContext();
      if (audioContextRef.current.state === "suspended")
        await audioContextRef.current.resume();
      recordingRef.current = true;
      startRecordingCycle(capture.stream, activeSessionId);
      setRecording(true);
      toast.success(
        captureMode === "mixed"
          ? "Live Call Companion started. Keep the call tab audio shared."
          : "Microphone transcription started."
      );
    } catch (error) {
      recordingRef.current = false;
      if (chunkTimerRef.current !== undefined) {
        window.clearTimeout(chunkTimerRef.current);
        chunkTimerRef.current = undefined;
      }
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
    recordingRef.current = false;
    if (chunkTimerRef.current !== undefined) {
      window.clearInterval(chunkTimerRef.current);
      chunkTimerRef.current = undefined;
    }
    if (recorder && recorder.state !== "inactive") {
      await new Promise<void>(resolve => {
        recorder.addEventListener("stop", () => resolve(), { once: true });
        recorder.stop();
      });
    }
    setRecording(false);
    sourcesRef.current.forEach(stream =>
      stream.getTracks().forEach(track => track.stop())
    );
    sourcesRef.current = [];
    await audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = undefined;
    await pendingRef.current;
    if (sessionId) {
      setCloseoutConfirmed(false);
      setAwaitingCloseout(true);
    }
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
      setCloseoutConfirmed(false);
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
    if (!closeoutConfirmed)
      return toast.error(
        "Confirm the outcome, callback and next-step details before preparing follow-up."
      );
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
          commitmentsConfirmed: closeoutConfirmed,
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
      <div id="calls-page" data-call-workflow className="text-[#26354A]">
        <header className="border-b border-[#DCE4EE] pb-6">
          <p className="text-[10px] font-black uppercase tracking-[.16em] text-[#55788B]">
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
                <Button
                  onClick={retryAction}
                  className="bg-[#55788B] hover:bg-[#405F70]"
                >
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

        {!sessionId &&
          initialCustomer.data &&
          initialCustomer.data.id === selectedContactId && (
            <section className="mt-6 rounded-2xl border border-[#DCE4EE] bg-white p-6">
              <p className="font-bold">{initialCustomer.data.name}</p>
              <p className="mt-2 text-sm">
                Course interest:{" "}
                {initialCustomer.data.interest.primary || "Not yet identified"}
              </p>
              <p className="mt-2 text-sm">
                {initialCustomer.data.nextAction?.title ||
                  "Review the enquiry and agree the next step."}
              </p>
              <Button
                variant="outline"
                className="mt-3"
                onClick={() =>
                  navigate(
                    `/assistant?contactId=${selectedContactId}&prompt=${encodeURIComponent("Prepare me for this call.")}`
                  )
                }
              >
                Prepare with AmarktAI
              </Button>
            </section>
          )}
        {callContext.data?.context && (
          <section className="mt-6 rounded-[1.5rem] border border-[#DCE4EE] bg-white p-6">
            <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#55788B]">
              PRE-CALL BRIEF
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
              {[
                [
                  "Customer",
                  `${callContext.data.context.contactName}${callContext.data.context.companyName ? ` · ${callContext.data.context.companyName}` : ""}\n${callContext.data.context.phone || callContext.data.context.email || "No phone or email available"}`,
                ],
                [
                  "Course interest",
                  callContext.data.context.courseInterest ||
                    "Not yet identified from CRM context",
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
                <div
                  key={label}
                  className="rounded-xl border border-[#E5EAF0] bg-[#F8FAFC] p-4"
                >
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
                <span className="grid size-10 place-items-center rounded-xl bg-[#EAF0F2] text-[#55788B]">
                  <Headphones size={19} />
                </span>                <div>
                  <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#55788B]">
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
            {initialCustomer.data?.interest.primary ? (
              <p className="mt-2 rounded-lg bg-[#EAF0F2] px-3 py-2 text-xs font-bold text-[#405F70]">
                Course interest: {initialCustomer.data.interest.primary}
              </p>
            ) : null}

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
                    className={`block w-full rounded-lg px-3 py-2 text-left text-xs ${selectedContactId === contact.id ? "bg-[#EAF0F2] text-[#405F70]" : "text-[#52647A] hover:bg-[#F2F5F8]"}`}
                  >
                    {" "}
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
                className={`rounded-xl border p-4 text-left transition ${captureMode === "mixed" ? "border-[#55788B] bg-[#EAF0F2]" : "border-[#DCE4EE] bg-[#F8FAFC] hover:border-[#B9C7D8]"}`}
              >
                <MonitorUp className="size-5 text-[#55788B]" />
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
                className={`rounded-xl border p-4 text-left transition ${captureMode === "microphone" ? "border-[#55788B] bg-[#EAF0F2]" : "border-[#DCE4EE] bg-[#F8FAFC] hover:border-[#B9C7D8]"}`}
              >
                <Mic className="size-5 text-[#55788B]" />
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
                  className="h-12 bg-[#55788B] hover:bg-[#405F70]"
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
              <p className="text-[10px] font-black uppercase tracking-[.13em] text-[#55788B]">
                LIVE TRANSCRIPT
              </p>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[#33445B]">
                {transcript ||
                  "Call notes will appear here while the conversation is running."}
              </p>
            </div>

            <section className="mt-5 rounded-xl border border-[#DCE4EE] bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-black uppercase tracking-[.13em] text-[#55788B]">
                  LIVE STRUCTURED NOTES
                </p>
                <span className="text-xs text-[#66758A]">
                  Updated from verified transcript signals
                </span>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <LiveNoteGroup
                  label="Goals / intentions heard"
                  items={structuredNotes.goals}
                />
                <LiveNoteGroup
                  label="Facts / context heard"
                  items={structuredNotes.facts}
                />
                <LiveNoteGroup
                  label="Customer questions"
                  items={structuredNotes.questions}
                />
                <LiveNoteGroup
                  label="Objections"
                  items={structuredNotes.objections}
                />
                <LiveNoteGroup
                  label="Buying signals"
                  items={structuredNotes.buyingSignals}
                />
                <LiveNoteGroup
                  label="Commitments heard — confirm speaker"
                  items={structuredNotes.commitments}
                />
                <LiveNoteGroup
                  label="Callback requests"
                  items={structuredNotes.callbackRequests}
                />
                <LiveNoteGroup
                  label="Dates / times mentioned"
                  items={structuredNotes.datesTimes}
                />
                <LiveNoteGroup
                  label="Likely next steps"
                  items={structuredNotes.nextSteps}
                />
                <LiveNoteGroup
                  label="Still unresolved"
                  items={structuredNotes.unresolvedItems}
                />
              </div>
            </section>

            {awaitingCloseout && (
              <section className="mt-5 rounded-xl border border-[#DCE4EE] bg-[#F8FAFC] p-5">
                <p className="text-[10px] font-black uppercase tracking-[.13em] text-[#55788B]">
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
                <div className="mt-4 rounded-xl bg-[#EAF0F2] p-3 text-xs leading-5 text-[#405F70]">
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
                <label className="mt-4 flex items-start gap-3 rounded-xl border border-[#DCE4EE] bg-white p-3 text-xs leading-5 text-[#405F70]">
                  <input
                    type="checkbox"
                    checked={closeoutConfirmed}
                    onChange={event =>
                      setCloseoutConfirmed(event.target.checked)
                    }
                    className="mt-0.5 h-4 w-4"
                  />
                  <span>
                    I have checked the outcome, callback time and next step
                    above. Treat these closeout details as
                    salesperson-confirmed. Transcript-derived notes remain
                    suggestions until confirmed here.
                  </span>
                </label>
                <Button
                  disabled={completing || !closeoutConfirmed}
                  onClick={() => void completeCloseout()}
                  className="mt-4 bg-[#55788B] hover:bg-[#405F70]"
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
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    onClick={() =>
                      navigate(
                        selectedContactId
                          ? `/reviews?contactId=${selectedContactId}`
                          : "/reviews"
                      )
                    }
                    className="bg-[#55788B] hover:bg-[#405F70]"
                  >
                    <ClipboardCheck className="mr-2 h-4 w-4" />
                    Review prepared work
                  </Button>
                  <Button variant="outline" onClick={() => navigate("/today")}>
                    Next person
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                  {selectedContactId ? (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        navigate(`/customers?contactId=${selectedContactId}`)
                      }
                    >
                      Open customer context
                    </Button>
                  ) : null}
                </div>
              </section>
            )}
          </section>

          <div className="grid gap-6">
            <section className="rounded-[1.5rem] border border-[#DCE4EE] bg-white p-6">
              <div className="flex items-center gap-3">
                <AlertTriangle className="size-5 text-[#55788B]" />
                <h2 className="font-display text-2xl font-bold tracking-[-.05em] text-[#26354A]">
                  Live signals
                </h2>
              </div>
              <div className="mt-4 space-y-3">
                {signals.length ? (
                  signals.map((signal, index) => (
                    <article
                      key={`${signal.type}-${index}`}
                      className={`rounded-xl border p-4 ${signal.priority === "important" ? "border-[#C9D8DE] bg-[#EAF0F2]" : "border-[#DCE4EE] bg-[#F8FAFC]"}`}
                    >
                      <p className="text-xs font-black uppercase tracking-[.1em] text-[#55788B]">
                        {signal.label}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-[#33445B]">