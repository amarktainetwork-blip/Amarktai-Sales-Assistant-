import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, CheckCircle2, Headphones, Mic, MonitorUp, Square, Waves } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type Signal = { type: string; label: string; evidence: string; priority: "normal" | "important" };
type CaptureMode = "microphone" | "mixed";
type TranscriptionResult = { text: string; signals: Signal[]; durationMs: number; rawAudioRetained: boolean };

function blobToBase64(blob: Blob) {
  return blob.arrayBuffer().then(buffer => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...Array.from(bytes.subarray(offset, offset + 0x8000)));
    return btoa(binary);
  });
}

async function getCaptureStream(mode: CaptureMode) {
  const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  if (mode === "microphone") return { stream: mic, sources: [mic], context: undefined as AudioContext | undefined };
  const display = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
  if (!display.getAudioTracks().length) {
    display.getTracks().forEach(track => track.stop());
    mic.getTracks().forEach(track => track.stop());
    throw new Error("No shared tab/system audio was provided. Select a browser tab and enable Share audio.");
  }
  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();
  context.createMediaStreamSource(mic).connect(destination);
  context.createMediaStreamSource(new MediaStream(display.getAudioTracks())).connect(destination);
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
  const [sttLabel, setSttLabel] = useState("Speech-to-text");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const sourcesRef = useRef<MediaStream[]>([]);
  const audioContextRef = useRef<AudioContext | undefined>(undefined);
  const pendingRef = useRef<Promise<void>>(Promise.resolve());
  const transcriptRef = useRef("");
  const lastCoachAtRef = useRef(0);

  const startSession = trpc.calls.startLive.useMutation();
  const coach = trpc.calls.coachTranscript.useMutation({ onSuccess: result => setTip(result.content) });
  const complete = trpc.calls.completeLive.useMutation({ onSuccess: result => setTip(result.content) });

  useEffect(() => {
    fetch("/api/live-calls/readiness", { credentials: "include" }).then(async response => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not check transcription readiness.");
      setSttReady(Boolean(body.ready));
      setSttLabel(body.provider || "Speech-to-text");
    }).catch(error => { setSttReady(false); console.warn(error); });
    return () => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
      sourcesRef.current.forEach(stream => stream.getTracks().forEach(track => track.stop()));
      void audioContextRef.current?.close();
    };
  }, []);

  async function uploadChunk(blob: Blob, activeSessionId: number) {
    if (!blob.size) return;
    const base64 = await blobToBase64(blob);
    const mimeType = (blob.type || "audio/webm").split(";")[0];
    const response = await fetch("/api/live-calls/transcribe", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callSessionId: activeSessionId, audioBase64: base64, mimeType, durationMs: 5000 }),
    });
    const result = await response.json().catch(() => ({})) as TranscriptionResult & { error?: string };
    if (!response.ok) throw new Error(result.error || `Transcription failed (${response.status}).`);
    const text = result.text?.trim();
    if (!text) return;
    transcriptRef.current = `${transcriptRef.current}${transcriptRef.current ? "\n" : ""}${text}`.slice(-40_000);
    setTranscript(transcriptRef.current);
    if (result.signals?.length) {
      setSignals(current => [...result.signals, ...current].filter((signal, index, all) => all.findIndex(other => other.type === signal.type && other.evidence === signal.evidence) === index).slice(0, 12));
      const needsCoach = result.signals.some(signal => signal.priority === "important" || signal.type === "question");
      if (needsCoach && Date.now() - lastCoachAtRef.current > 15_000 && !coach.isPending) {
        lastCoachAtRef.current = Date.now();
        coach.mutate({ callSessionId: activeSessionId, leadLabel, transcriptChunk: text });
      }
    }
  }

  async function begin() {
    if (!leadLabel.trim()) return toast.error("Enter the customer/contact before starting.");
    if (!consent) return toast.error("Confirm that this call may be transcribed under your organisation's policy.");
    if (!sttReady) return toast.error("Speech-to-text is not configured for this deployment.");
    try {
      const activeSessionId = sessionId ?? await startSession.mutateAsync({ leadLabel: leadLabel.trim() });
      setSessionId(activeSessionId);
      const capture = await getCaptureStream(captureMode);
      sourcesRef.current = capture.sources;
      audioContextRef.current = capture.context;
      const preferred = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
      const recorder = preferred ? new MediaRecorder(capture.stream, { mimeType: preferred, audioBitsPerSecond: 64000 }) : new MediaRecorder(capture.stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = event => {
        if (!event.data.size) return;
        pendingRef.current = pendingRef.current.then(() => uploadChunk(event.data, activeSessionId)).catch(error => toast.error(error instanceof Error ? error.message : "Live transcription failed."));
      };
      recorder.start(5000);
      setRecording(true);
      toast.success(captureMode === "mixed" ? "Live Call Companion started. Keep the selected call tab/system audio shared." : "Microphone transcription started.");
    } catch (error) {
      sourcesRef.current.forEach(stream => stream.getTracks().forEach(track => track.stop()));
      sourcesRef.current = [];
      void audioContextRef.current?.close();
      audioContextRef.current = undefined;
      toast.error(error instanceof Error ? error.message : "Could not start audio capture.");
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
    sourcesRef.current.forEach(stream => stream.getTracks().forEach(track => track.stop()));
    sourcesRef.current = [];
    await audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = undefined;
    await pendingRef.current;
    if (sessionId && transcriptRef.current.trim().length >= 4) {
      try {
        await complete.mutateAsync({ callSessionId: sessionId, leadLabel, transcript: transcriptRef.current });
        toast.success("Call stopped. Transcript and post-call summary are ready for review.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not complete the call summary.");
      }
    }
  }

  return <DashboardLayout>
    <header className="border-b border-white/10 pb-6">
      <p className="text-[10px] font-black uppercase tracking-[.16em] text-[#83AEFF]">AMARKTAI / LIVE CALL COMPANION</p>
      <h1 className="mt-3 font-display text-4xl font-bold tracking-[-.06em] text-white sm:text-5xl">Listen less to the admin. Listen more to the customer.</h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-[#A9BFDF]">Authorised call audio is transcribed in short chunks, live signals are detected locally in code, and GenX is called only when semantic coaching is useful. Raw chunks are forwarded to your configured STT service and are not retained by this bridge.</p>
    </header>
    <div className="mt-6 grid gap-6 xl:grid-cols-[1.05fr_.95fr]">
      <section className="rounded-[1.5rem] border border-white/10 bg-[#0E2142] p-6">
        <div className="flex items-center justify-between gap-4"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-[#153B7A] text-[#94B9FF]"><Headphones size={19}/></span><div><p className="text-[10px] font-black uppercase tracking-[.14em] text-[#7FAAF8]">CALL AUDIO</p><h2 className="font-display text-2xl font-bold tracking-[-.05em] text-white">Live session</h2></div></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${sttReady ? "bg-emerald-400/10 text-emerald-200" : "bg-amber-400/10 text-amber-100"}`}>{sttReady === null ? "Checking STT…" : sttReady ? `${sttLabel} ready` : "STT not configured"}</span></div>
        <label className="mt-6 block text-xs font-black uppercase tracking-[.12em] text-[#9EB6DB]">Customer / contact</label>
        <Input disabled={recording} value={leadLabel} onChange={event => setLeadLabel(event.target.value)} placeholder="Jane Smith" className="mt-2 border-white/15 bg-[#08172F] text-white placeholder:text-[#607EA8]"/>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <button disabled={recording} onClick={() => setCaptureMode("mixed")} className={`rounded-xl border p-4 text-left ${captureMode === "mixed" ? "border-[#4E8BFF] bg-[#153B7A]" : "border-white/10 bg-[#0B1B37]"}`}><MonitorUp className="size-5 text-[#8BB4FF]"/><p className="mt-3 font-bold text-white">Call audio + microphone</p><p className="mt-1 text-xs leading-5 text-[#9EB6DB]">Best for browser diallers. Select the call tab/system source and share its audio; Amarktai mixes it with your microphone.</p></button>
          <button disabled={recording} onClick={() => setCaptureMode("microphone")} className={`rounded-xl border p-4 text-left ${captureMode === "microphone" ? "border-[#4E8BFF] bg-[#153B7A]" : "border-white/10 bg-[#0B1B37]"}`}><Mic className="size-5 text-[#8BB4FF]"/><p className="mt-3 font-bold text-white">Microphone only</p><p className="mt-1 text-xs leading-5 text-[#9EB6DB]">Fallback for speakerphone/headset environments where the microphone can capture the authorised conversation.</p></button>
        </div>
        <label className="mt-5 flex cursor-pointer gap-3 rounded-xl border border-white/10 bg-[#08172F] p-4 text-sm leading-6 text-[#C4D3E9]"><input type="checkbox" checked={consent} disabled={recording} onChange={event => setConsent(event.target.checked)} className="mt-1 size-4"/><span>I confirm that my organisation authorises transcription/recording assistance for this call and that required participant notice/consent has been handled.</span></label>
        <div className="mt-5 flex flex-wrap gap-3">
          {!recording ? <Button disabled={!leadLabel.trim() || !consent || !sttReady || startSession.isPending} onClick={() => void begin()} className="h-12 bg-[#1B64F2] hover:bg-[#2B76FF]"><Waves className="mr-2 size-4"/>Start Live Companion</Button> : <Button onClick={() => void stop()} className="h-12 bg-rose-600 hover:bg-rose-500"><Square className="mr-2 size-4"/>Stop & prepare closeout</Button>}
          {recording && <span className="inline-flex items-center gap-2 rounded-xl bg-emerald-400/10 px-4 text-sm font-bold text-emerald-200"><span className="size-2 animate-pulse rounded-full bg-emerald-300"/>Listening</span>}
        </div>
        <div className="mt-6 min-h-48 rounded-xl border border-white/10 bg-[#08172F] p-4"><p className="text-[10px] font-black uppercase tracking-[.13em] text-[#7FAAF8]">LIVE TRANSCRIPT</p><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[#DCE6F6]">{transcript || "Finalised transcript chunks will appear here while the call is running."}</p></div>
      </section>
      <div className="grid gap-6">
        <section className="rounded-[1.5rem] border border-white/10 bg-[#0E2142] p-6"><div className="flex items-center gap-3"><AlertTriangle className="size-5 text-[#83AEFF]"/><h2 className="font-display text-2xl font-bold tracking-[-.05em] text-white">Live signals</h2></div><div className="mt-4 space-y-3">{signals.length ? signals.map((signal, index) => <article key={`${signal.type}-${index}`} className={`rounded-xl border p-4 ${signal.priority === "important" ? "border-[#4E8BFF]/50 bg-[#153B7A]" : "border-white/10 bg-[#0B1B37]"}`}><p className="text-xs font-black uppercase tracking-[.1em] text-[#8FB7FF]">{signal.label}</p><p className="mt-2 text-sm leading-6 text-[#D9E5F7]">{signal.evidence}</p></article>) : <p className="text-sm leading-6 text-[#9EB6DB]">Questions, objections, commitments, callback requests and buying signals detected by deterministic rules will appear here.</p>}</div></section>
        <section className="rounded-[1.5rem] border border-white/10 bg-[#0E2142] p-6"><div className="flex items-center gap-3"><CheckCircle2 className="size-5 text-[#83AEFF]"/><h2 className="font-display text-2xl font-bold tracking-[-.05em] text-white">Current coaching</h2></div><p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-[#D9E5F7]">{tip || "A short coaching response appears only when an important signal or question warrants semantic help. Routine transcription does not call GenX."}</p></section>
      </div>
    </div>
  </DashboardLayout>;
}
