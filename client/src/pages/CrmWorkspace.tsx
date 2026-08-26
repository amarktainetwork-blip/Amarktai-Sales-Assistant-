import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import {
  Bot,
  ChevronLeft,
  Expand,
  GripVertical,
  Loader2,
  Maximize2,
  Minimize2,
  MonitorUp,
  MousePointer2,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation, useRoute } from "wouter";

type ViewerReady = {
  viewerSessionId: string;
  viewerToken: string;
  expiresAt: string;
  url: string;
  control: string;
};

type StreamMessage =
  | { type: "ready"; url: string; control: string; expiresAt: string }
  | { type: "frame"; data: string; url: string }
  | { type: "navigation"; url: string }
  | { type: "control"; control: string; message?: string }
  | { type: "error"; code: string; message?: string }
  | { type: "disconnected"; message: string };

function streamUrl(session: ViewerReady) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(`${protocol}//${window.location.host}/api/crm-viewer/stream`);
  url.searchParams.set("session", session.viewerSessionId);
  url.searchParams.set("token", session.viewerToken);
  return url.toString();
}

export default function CrmWorkspace() {
  const [, params] = useRoute("/crm/:connectedSystemId");
  const [, navigate] = useLocation();
  const organisation = trpc.organisation.current.useQuery();
  const systems = trpc.connectedSystems.list.useQuery(
    { organisationId: organisation.data?.organisationId || 0 },
    { enabled: Boolean(organisation.data?.organisationId) }
  );
  const [selectedId, setSelectedId] = useState<number | null>(
    params?.connectedSystemId ? Number(params.connectedSystemId) : null
  );
  const selected = useMemo(
    () => systems.data?.find(system => system.id === selectedId) ||
      systems.data?.find(system => system.connectionMethod === "browser" || system.connectionMethod === "sidecar") ||
      null,
    [selectedId, systems.data]
  );
  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);

  return (
    <DashboardLayout>
      <div className="min-h-[calc(100vh-4rem)] bg-slate-50 p-3 lg:p-5">
        <div className="mx-auto max-w-[1800px]">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[.16em] text-slate-500">CRM workspace</p>
              <h1 className="truncate text-lg font-bold text-slate-900">{selected?.displayName || "Open your CRM"}</h1>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => navigate("/today")}>
                <ChevronLeft className="mr-1 h-4 w-4" /> Today
              </Button>
              {systems.data && systems.data.length > 1 ? (
                <select
                  aria-label="Choose CRM"
                  value={selected?.id || ""}
                  onChange={event => navigate(`/crm/${event.target.value}`)}
                  className="h-9 max-w-48 rounded-md border border-slate-200 bg-white px-2 text-sm"
                >
                  {systems.data
                    .filter(system => system.connectionMethod === "browser" || system.connectionMethod === "sidecar")
                    .map(system => <option key={system.id} value={system.id}>{system.displayName}</option>)}
                </select>
              ) : null}
            </div>
          </div>
          {selected ? <LiveWorkspace key={selected.id} connectedSystemId={selected.id} crmName={selected.displayName} /> : <NoBrowserCrm onConnections={() => navigate("/connections")} />}
        </div>
      </div>
    </DashboardLayout>
  );
}

function LiveWorkspace({ connectedSystemId, crmName }: { connectedSystemId: number; crmName: string }) {
  const open = trpc.crmViewer.open.useMutation();
  const acquireAi = trpc.crmViewer.acquireAssistantControl.useMutation();
  const releaseAi = trpc.crmViewer.releaseAssistantControl.useMutation();
  const [session, setSession] = useState<ViewerReady | null>(null);
  const [control, setControl] = useState("IDLE");
  const [mode, setMode] = useState<"split" | "crm" | "assistant">("split");
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [assistantWidth, setAssistantWidth] = useState(420);
  const [resizingAssistant, setResizingAssistant] = useState(false);
  const [image, setImage] = useState("");
  const [status, setStatus] = useState("Connecting to the authorized CRM…");
  const viewerRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const openViewer = async () => {
    try {
      setStatus("Connecting to the authorized CRM…");
      const next = await open.mutateAsync({ connectedSystemId });
      setSession(next);
      setControl(next.control);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The CRM workspace could not be opened.");
    }
  };
  useEffect(() => { void openViewer(); return () => socketRef.current?.close(); }, [connectedSystemId]);
  useEffect(() => {
    if (!session) return;
    const socket = new WebSocket(streamUrl(session));
    socketRef.current = socket;
    socket.onopen = () => {
      setStatus("Connected");
      const rect = viewerRef.current?.getBoundingClientRect();
      if (rect) socket.send(JSON.stringify({ type: "resize", width: rect.width, height: rect.height, deviceScaleFactor: Math.min(2, window.devicePixelRatio || 1) }));
    };
    socket.onmessage = event => {
      const message = JSON.parse(String(event.data)) as StreamMessage;
      if (message.type === "frame") {
        setImage(`data:image/jpeg;base64,${message.data}`);
        setStatus("Connected");
      } else if (message.type === "control") {
        setControl(message.control);
        if (message.message) toast.info(message.message);
      } else if (message.type === "ready") {
        setControl(message.control);
        setStatus("Connected");
      } else if (message.type === "disconnected") {
        setStatus(message.message);
      } else if (message.type === "error") {
        setStatus(message.message || message.code);
      }
    };
    socket.onclose = () => setStatus("Connection paused. Reconnect to continue.");
    return () => socket.close();
  }, [session]);
  useEffect(() => {
    if (!resizingAssistant) return;
    const onMove = (event: PointerEvent) =>
      setAssistantWidth(Math.max(330, Math.min(680, window.innerWidth - event.clientX)));
    const onUp = () => setResizingAssistant(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [resizingAssistant]);
  useEffect(() => {
    const onVisibility = () => send({ type: "visibility", visible: !document.hidden });
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility();
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [session]);
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      const rect = viewerRef.current?.getBoundingClientRect();
      if (rect && socketRef.current?.readyState === WebSocket.OPEN)
        socketRef.current.send(JSON.stringify({ type: "resize", width: rect.width, height: rect.height, deviceScaleFactor: Math.min(2, window.devicePixelRatio || 1) }));
    });
    if (viewerRef.current) observer.observe(viewerRef.current);
    return () => observer.disconnect();
  }, []);

  const send = (payload: unknown) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(JSON.stringify(payload));
  };
  const forwardPointer = (event: React.PointerEvent<HTMLDivElement>, type: "mousePressed" | "mouseReleased" | "mouseMoved") => {
    const rect = event.currentTarget.getBoundingClientRect();
    send({ type: "input", event: { kind: "mouse", type, x: event.clientX - rect.left, y: event.clientY - rect.top, button: event.button === 2 ? "right" : event.button === 1 ? "middle" : event.button === 0 ? "left" : "none", clickCount: event.detail || 1 } });
  };
  const forwardKey = (event: React.KeyboardEvent<HTMLDivElement>, type: "keyDown" | "keyUp") => {
    if (["Tab", "Escape"].includes(event.key)) return;
    event.preventDefault();
    send({ type: "input", event: { kind: "key", type, key: event.key, code: event.code, text: event.key.length === 1 ? event.key : "" } });
  };
  const requestAi = async () => {
    if (!session) return;
    try {
      await acquireAi.mutateAsync({ viewerSessionId: session.viewerSessionId });
      setControl("AI_CONTROL");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Amarktai could not take control right now."); }
  };
  const stopAi = async () => {
    if (!session) return;
    await releaseAi.mutateAsync({ viewerSessionId: session.viewerSessionId });
    setControl("READ_ONLY_OBSERVE");
  };

  return <div className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${mode === "crm" ? "" : ""}`}>
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
      <div className="flex items-center gap-2 text-sm"><span className={`h-2.5 w-2.5 rounded-full ${status === "Connected" ? "bg-emerald-500" : "bg-amber-400"}`} /> <span className="font-medium text-slate-700">{status} · {control === "READ_ONLY_OBSERVE" ? "Read-only until you interact" : control === "HUMAN_CONTROL" ? "You control the CRM" : "Amarktai is working"}</span></div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void openViewer()} disabled={open.isPending}><RefreshCw className={`mr-1 h-4 w-4 ${open.isPending ? "animate-spin" : ""}`} />Reconnect</Button>
        <Button variant="outline" size="sm" onClick={() => setMode(mode === "crm" ? "split" : "crm")}><Maximize2 className="mr-1 h-4 w-4" />{mode === "crm" ? "Split view" : "CRM only"}</Button>
        <Button variant="outline" size="sm" onClick={() => setAssistantOpen(!assistantOpen)}>{assistantOpen ? <PanelLeftClose className="mr-1 h-4 w-4" /> : <PanelLeftOpen className="mr-1 h-4 w-4" />}{assistantOpen ? "Hide assistant" : "Show assistant"}</Button>
      </div>
    </header>
    <div
      className={`grid min-h-[70vh] ${mode === "crm" || !assistantOpen ? "grid-cols-1" : ""}`}
      style={mode === "crm" || !assistantOpen ? undefined : { gridTemplateColumns: `minmax(0, 1fr) minmax(330px, ${assistantWidth}px)` }}
    >
      <div className="relative min-h-[58vh] bg-slate-900">
        <div
          ref={viewerRef}
          role="application"
          aria-label={`${crmName} live CRM`}
          tabIndex={0}
          onPointerDown={event => forwardPointer(event, "mousePressed")}
          onPointerUp={event => forwardPointer(event, "mouseReleased")}
          onPointerMove={event => forwardPointer(event, "mouseMoved")}
          onWheel={event => { const rect = event.currentTarget.getBoundingClientRect(); send({ type: "input", event: { kind: "mouse", type: "mouseWheel", x: event.clientX - rect.left, y: event.clientY - rect.top, deltaX: event.deltaX, deltaY: event.deltaY } }); }}
          onKeyDown={event => forwardKey(event, "keyDown")}
          onKeyUp={event => forwardKey(event, "keyUp")}
          className="relative h-full min-h-[58vh] cursor-default overflow-hidden outline-none focus-visible:ring-4 focus-visible:ring-blue-400"
        >
          {image ? <img src={image} alt="Live CRM session" draggable={false} className="h-full w-full select-none object-contain" /> : <div className="flex h-full min-h-[58vh] flex-col items-center justify-center gap-3 text-slate-300"><Loader2 className="h-7 w-7 animate-spin" /><p>{status}</p></div>}
          <div className="absolute bottom-3 left-3 rounded-full bg-slate-950/80 px-3 py-1.5 text-xs font-semibold text-white"><MousePointer2 className="mr-1 inline h-3.5 w-3.5" />{control === "HUMAN_CONTROL" ? "You control the CRM" : control === "AI_CONTROL" ? "Amarktai is updating this record" : "Read-only observation"}</div>
        </div>
      </div>
      {mode !== "crm" && assistantOpen ? <aside className="relative flex min-h-[420px] flex-col border-l border-slate-200 bg-slate-50">
        <button aria-label="Resize assistant panel" onPointerDown={() => setResizingAssistant(true)} className="absolute -left-2 top-0 z-10 flex h-full w-4 cursor-col-resize items-center justify-center bg-transparent"><GripVertical className="h-4 w-4 rounded bg-white text-slate-400 shadow-sm" /></button>
        <div className="border-b border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><Bot className="h-5 w-5 text-blue-600" /><h2 className="font-bold text-slate-900">Amarktai Assistant</h2></div><p className="mt-2 text-sm text-slate-600">Ask about the customer or page you are working with.</p></div>
        <div className="flex-1 p-5"><div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-slate-700">I can help prepare a call, explain customer history, or create a review-ready update. I will not interrupt while you are using the CRM.</div></div>
        <div className="border-t border-slate-200 bg-white p-4"><div className="flex gap-2"><input aria-label="Ask Amarktai" className="h-10 flex-1 rounded-lg border border-slate-300 px-3 text-sm" placeholder="Ask anything about this customer…" /><Button size="sm">Ask</Button></div><div className="mt-3 flex gap-2"><Button variant="outline" size="sm" onClick={() => void requestAi()} disabled={control === "HUMAN_CONTROL" || acquireAi.isPending}><ShieldCheck className="mr-1 h-4 w-4" />{control === "AI_CONTROL" ? "Assistant control" : "Let Amarktai update"}</Button>{control === "AI_CONTROL" ? <Button variant="ghost" size="sm" onClick={() => void stopAi()}>Return control</Button> : null}</div></div>
      </aside> : null}
    </div>
    <div className="sr-only" aria-live="polite">{control === "HUMAN_CONTROL" ? "You currently control the CRM." : status}</div>
  </div>;
}

function NoBrowserCrm({ onConnections }: { onConnections: () => void }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><MonitorUp className="mx-auto h-8 w-8 text-slate-400" /><h2 className="mt-4 text-lg font-bold text-slate-900">Connect a browser CRM to work here</h2><p className="mx-auto mt-2 max-w-md text-sm text-slate-600">Once your CRM connection is ready, you can use its actual secured browser session alongside Amarktai.</p><Button className="mt-5" onClick={onConnections}>Open connections</Button></div>;
}
