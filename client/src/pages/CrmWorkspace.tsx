import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import {
  Bot,
  ArrowLeft,
  ArrowRight,
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
  Globe2,
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
  | { type: "disconnected"; message: string }
  | {
      type: "session";
      currentUrl: string;
      authenticationState: string;
      connectionHealth: string;
      errorMessage?: string;
      blockedDestination?: string;
    };

function streamUrl(session: ViewerReady) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(
    `${protocol}//${window.location.host}/api/crm-viewer/stream`
  );
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
    {
      enabled: Boolean(organisation.data?.organisationId),
      refetchInterval: 3_000,
    }
  );
  const [selectedId, setSelectedId] = useState<number | null>(
    params?.connectedSystemId ? Number(params.connectedSystemId) : null
  );
  const selected = useMemo(
    () =>
      systems.data?.find(system => system.id === selectedId) ||
      systems.data?.find(system => system.baseUrl) ||
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
              <p className="text-[10px] font-black uppercase tracking-[.16em] text-slate-500">
                CRM workspace
              </p>
              <h1 className="truncate text-lg font-bold text-slate-900">
                {selected?.displayName || "Open your CRM"}
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/today")}
              >
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
                    .filter(system => system.baseUrl)
                    .map(system => (
                      <option key={system.id} value={system.id}>
                        {system.displayName}
                      </option>
                    ))}
                </select>
              ) : null}
            </div>
          </div>
          {selected ? (
            <LiveWorkspace
              key={selected.id}
              connectedSystemId={selected.id}
              crmName={selected.displayName}
              capabilities={[
                ...selected.allowedReadCapabilities,
                ...selected.allowedWriteCapabilities,
              ]}
              readyCapabilities={selected.verifiedCapabilities}
            />
          ) : (
            <NoBrowserCrm onConnections={() => navigate("/connections")} />
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

function LiveWorkspace({
  connectedSystemId,
  crmName,
  capabilities,
  readyCapabilities,
}: {
  connectedSystemId: number;
  crmName: string;
  capabilities: string[];
  readyCapabilities: string[];
}) {
  const open = trpc.crmViewer.open.useMutation();
  const acquireAi = trpc.crmViewer.acquireAssistantControl.useMutation();
  const releaseAi = trpc.crmViewer.releaseAssistantControl.useMutation();
  const askAssistant = trpc.crmViewer.askAssistant.useMutation();
  const [session, setSession] = useState<ViewerReady | null>(null);
  const [control, setControl] = useState("IDLE");
  const [mode, setMode] = useState<"split" | "crm" | "assistant">("split");
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [assistantWidth, setAssistantWidth] = useState(420);
  const [resizingAssistant, setResizingAssistant] = useState(false);
  const [image, setImage] = useState("");
  const [status, setStatus] = useState("Connecting to the authorized CRM…");
  const [currentUrl, setCurrentUrl] = useState("");
  const [authenticationState, setAuthenticationState] = useState("STARTING");
  const [assistantPrompt, setAssistantPrompt] = useState("");
  const [assistantResult, setAssistantResult] = useState<string | null>(null);
  const [activity, setActivity] = useState<string[]>([
    "Secure CRM workspace opened",
  ]);
  const viewerRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const openViewer = async () => {
    try {
      socketRef.current?.close(1000, "Replacing CRM viewer session");
      socketRef.current = null;
      setSession(null);
      setImage("");
      setStatus("Connecting to the authorized CRM…");
      const next = await open.mutateAsync({ connectedSystemId });
      setSession(next);
      setControl(next.control);
      setCurrentUrl(next.url);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "The CRM workspace could not be opened."
      );
    }
  };
  useEffect(() => {
    void openViewer();
    return () => socketRef.current?.close();
  }, [connectedSystemId]);
  useEffect(() => {
    if (!session) return;
    const socket = new WebSocket(streamUrl(session));
    socketRef.current = socket;
    socket.onopen = () => {
      setStatus("Connected");
      const rect = viewerRef.current?.getBoundingClientRect();
      if (rect)
        socket.send(
          JSON.stringify({
            type: "resize",
            width: rect.width,
            height: rect.height,
            deviceScaleFactor: Math.min(2, window.devicePixelRatio || 1),
          })
        );
    };
    socket.onmessage = event => {
      const message = JSON.parse(String(event.data)) as StreamMessage;
      if (message.type === "frame") {
        setImage(`data:image/jpeg;base64,${message.data}`);
        setStatus("Connected");
      } else if (message.type === "control") {
        setControl(message.control);
        setActivity(current =>
          [
            `${message.control === "HUMAN_CONTROL" ? "Human took control" : message.control === "AGENT_CONTROL" ? "Amarktai took control" : "Browser control returned to idle"} · ${new Date().toLocaleTimeString()}`,
            ...current,
          ].slice(0, 5)
        );
        if (message.message) toast.info(message.message);
      } else if (message.type === "ready") {
        setControl(message.control);
        setStatus("Connected");
        setCurrentUrl(message.url);
      } else if (message.type === "navigation") {
        setCurrentUrl(message.url);
      } else if (message.type === "session") {
        setCurrentUrl(message.currentUrl);
        setAuthenticationState(message.authenticationState);
        if (message.authenticationState === "AUTHENTICATED")
          setActivity(current =>
            current[0]?.startsWith("CRM session authenticated")
              ? current
              : [
                  `CRM session authenticated · ${new Date().toLocaleTimeString()}`,
                  ...current,
                ].slice(0, 5)
          );
        setStatus(
          message.errorMessage ||
            (message.authenticationState === "AUTHENTICATED"
              ? "CRM connected · Secure session ready"
              : message.authenticationState === "CHECKING"
                ? "Checking your connection…"
                : message.authenticationState === "MFA_OR_SSO"
                  ? "Complete verification directly in the CRM"
                  : "Sign in directly to your CRM")
        );
      } else if (message.type === "disconnected") {
        setStatus(message.message);
      } else if (message.type === "error") {
        setStatus(message.message || message.code);
      }
    };
    socket.onclose = () =>
      setStatus("Connection paused. Reconnect to continue.");
    return () => socket.close();
  }, [session]);
  useEffect(() => {
    if (!resizingAssistant) return;
    const onMove = (event: PointerEvent) =>
      setAssistantWidth(
        Math.max(330, Math.min(680, window.innerWidth - event.clientX))
      );
    const onUp = () => setResizingAssistant(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [resizingAssistant]);
  useEffect(() => {
    const onVisibility = () =>
      send({ type: "visibility", visible: !document.hidden });
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility();
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [session]);
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      const rect = viewerRef.current?.getBoundingClientRect();
      if (rect && socketRef.current?.readyState === WebSocket.OPEN)
        socketRef.current.send(
          JSON.stringify({
            type: "resize",
            width: rect.width,
            height: rect.height,
            deviceScaleFactor: Math.min(2, window.devicePixelRatio || 1),
          })
        );
    });
    if (viewerRef.current) observer.observe(viewerRef.current);
    return () => observer.disconnect();
  }, []);

  const send = (payload: unknown) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(JSON.stringify(payload));
  };
  const forwardPointer = (
    event:
      | React.PointerEvent<HTMLDivElement>
      | React.MouseEvent<HTMLDivElement>,
    type: "mousePressed" | "mouseReleased" | "mouseMoved"
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    send({
      type: "input",
      event: {
        kind: "mouse",
        type,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        button:
          event.button === 2
            ? "right"
            : event.button === 1
              ? "middle"
              : event.button === 0
                ? "left"
                : "none",
        clickCount: event.detail || 1,
      },
    });
  };
  const forwardKey = (
    event: React.KeyboardEvent<HTMLDivElement>,
    type: "keyDown" | "keyUp"
  ) => {
    const unsafeBrowserShortcut =
      (event.metaKey || event.ctrlKey) && /^[lrtnqw]$/i.test(event.key);
    if (unsafeBrowserShortcut) return;
    event.preventDefault();
    const modifiers =
      (event.altKey ? 1 : 0) |
      (event.ctrlKey ? 2 : 0) |
      (event.metaKey ? 4 : 0) |
      (event.shiftKey ? 8 : 0);
    send({
      type: "input",
      event: {
        kind: "key",
        type,
        key: event.key,
        code: event.code,
        text:
          event.key.length === 1 && !event.ctrlKey && !event.metaKey
            ? event.key
            : "",
        modifiers,
      },
    });
  };
  const requestAi = async () => {
    if (!session) return;
    try {
      await acquireAi.mutateAsync({ viewerSessionId: session.viewerSessionId });
      setControl("AGENT_CONTROL");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Amarktai could not take control right now."
      );
    }
  };
  const stopAi = async () => {
    if (!session) return;
    await releaseAi.mutateAsync({ viewerSessionId: session.viewerSessionId });
    setControl("IDLE");
  };
  const takeControl = () => send({ type: "acquireHumanControl" });
  const navigateBrowser = (action: "back" | "forward" | "refresh") =>
    send({ type: "navigation", action });
  const confirmSignedIn = () => send({ type: "customerFinishedSigningIn" });
  const submitAssistant = async () => {
    if (!session || !assistantPrompt.trim()) return;
    try {
      const result = await askAssistant.mutateAsync({
        viewerSessionId: session.viewerSessionId,
        command: assistantPrompt.trim(),
      });
      setAssistantResult(result.summary);
      setAssistantPrompt("");
    } catch (error) {
      setAssistantResult(
        error instanceof Error
          ? error.message
          : "Amarktai could not process that request safely."
      );
    }
  };

  const domain = (() => {
    try {
      return new URL(currentUrl).hostname;
    } catch {
      return crmName;
    }
  })();
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${mode === "crm" ? "" : ""}`}
    >
      <header className="border-b border-slate-200 bg-slate-100 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            <Button
              aria-label="Back"
              variant="ghost"
              size="sm"
              onClick={() => navigateBrowser("back")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Button
              aria-label="Forward"
              variant="ghost"
              size="sm"
              onClick={() => navigateBrowser("forward")}
            >
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button
              aria-label="Refresh CRM"
              variant="ghost"
              size="sm"
              onClick={() => navigateBrowser("refresh")}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex min-w-52 flex-1 items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700">
            <Globe2 className="h-4 w-4 text-emerald-600" />
            <span className="font-semibold">{crmName}</span>
            <span className="truncate text-slate-500">{domain}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`h-2.5 w-2.5 rounded-full ${authenticationState === "AUTHENTICATED" ? "bg-emerald-500" : "bg-amber-400"}`}
            />
            <span className="font-medium text-slate-700">
              {control === "IDLE"
                ? "Idle"
                : control === "HUMAN_CONTROL"
                  ? "You control"
                  : "Amarktai control"}
            </span>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-slate-700">{status}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={takeControl}
              disabled={control === "AGENT_CONTROL"}
            >
              <MousePointer2 className="mr-1 h-4 w-4" />
              Take control
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void requestAi()}
              disabled={control === "HUMAN_CONTROL" || acquireAi.isPending}
            >
              <ShieldCheck className="mr-1 h-4 w-4" />
              Give control to Amarktai
            </Button>
            {authenticationState !== "AUTHENTICATED" ? (
              <Button size="sm" onClick={confirmSignedIn}>
                I've finished signing in
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void openViewer()}
              disabled={open.isPending}
            >
              <RefreshCw
                className={`mr-1 h-4 w-4 ${open.isPending ? "animate-spin" : ""}`}
              />
              Reconnect
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMode(mode === "crm" ? "split" : "crm")}
            >
              <Maximize2 className="mr-1 h-4 w-4" />
              {mode === "crm" ? "Split view" : "CRM only"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAssistantOpen(!assistantOpen)}
            >
              {assistantOpen ? (
                <PanelLeftClose className="mr-1 h-4 w-4" />
              ) : (
                <PanelLeftOpen className="mr-1 h-4 w-4" />
              )}
              {assistantOpen ? "Hide assistant" : "Show assistant"}
            </Button>
          </div>
        </div>
      </header>
      <div
        className={`grid min-h-[70vh] ${mode === "crm" || !assistantOpen ? "grid-cols-1" : ""}`}
        style={
          mode === "crm" || !assistantOpen
            ? undefined
            : {
                gridTemplateColumns: `minmax(0, 1fr) minmax(330px, ${assistantWidth}px)`,
              }
        }
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
            onDoubleClick={event => forwardPointer(event, "mousePressed")}
            onWheel={event => {
              event.preventDefault();
              const rect = event.currentTarget.getBoundingClientRect();
              send({
                type: "input",
                event: {
                  kind: "mouse",
                  type: "mouseWheel",
                  x: event.clientX - rect.left,
                  y: event.clientY - rect.top,
                  deltaX: event.deltaX,
                  deltaY: event.deltaY,
                },
              });
            }}
            onKeyDown={event => forwardKey(event, "keyDown")}
            onKeyUp={event => forwardKey(event, "keyUp")}
            className="relative h-full min-h-[58vh] cursor-default overflow-hidden outline-none focus-visible:ring-4 focus-visible:ring-blue-400"
          >
            {image ? (
              <img
                src={image}
                alt="Live CRM session"
                draggable={false}
                className="h-full w-full select-none object-contain"
              />
            ) : (
              <div className="flex h-full min-h-[58vh] flex-col items-center justify-center gap-3 text-slate-300">
                <Loader2 className="h-7 w-7 animate-spin" />
                <p>{status}</p>
              </div>
            )}
            <div className="absolute bottom-3 left-3 rounded-full bg-slate-950/80 px-3 py-1.5 text-xs font-semibold text-white">
              <MousePointer2 className="mr-1 inline h-3.5 w-3.5" />
              {control === "HUMAN_CONTROL"
                ? "You control the CRM"
                : control === "AGENT_CONTROL"
                  ? "Amarktai is working in your CRM"
                  : "Idle"}
            </div>
          </div>
        </div>
        {mode !== "crm" && assistantOpen ? (
          <aside className="relative flex min-h-[420px] flex-col border-l border-slate-200 bg-slate-50">
            <button
              aria-label="Resize assistant panel"
              onPointerDown={() => setResizingAssistant(true)}
              className="absolute -left-2 top-0 z-10 flex h-full w-4 cursor-col-resize items-center justify-center bg-transparent"
            >
              <GripVertical className="h-4 w-4 rounded bg-white text-slate-400 shadow-sm" />
            </button>
            <div className="border-b border-slate-200 bg-white p-5">
              <div className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-blue-600" />
                <h2 className="font-bold text-slate-900">Amarktai Assistant</h2>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                Ask about the customer or page you are working with.
              </p>
            </div>
            <div className="flex-1 space-y-3 p-5">
              <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-slate-700">
                I can help prepare a call, explain customer history, or prepare
                a review-ready update. I use the governed assistant path and
                will not make an uncontrolled CRM change.
              </div>
              {assistantResult ? (
                <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700">
                  {assistantResult}
                </div>
              ) : null}
            </div>
            <div className="border-t border-slate-200 bg-white p-4">
              <div className="flex gap-2">
                <input
                  aria-label="Ask Amarktai"
                  value={assistantPrompt}
                  onChange={event => setAssistantPrompt(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void submitAssistant();
                    }
                  }}
                  className="h-10 flex-1 rounded-lg border border-slate-300 px-3 text-sm"
                  placeholder="Ask anything about this customer…"
                />
                <Button
                  size="sm"
                  onClick={() => void submitAssistant()}
                  disabled={!assistantPrompt.trim() || askAssistant.isPending}
                >
                  {askAssistant.isPending ? "Thinking…" : "Ask"}
                </Button>
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void requestAi()}
                  disabled={control === "HUMAN_CONTROL" || acquireAi.isPending}
                >
                  <ShieldCheck className="mr-1 h-4 w-4" />
                  {control === "AGENT_CONTROL"
                    ? "Assistant control"
                    : "Let Amarktai update"}
                </Button>
                {control === "AGENT_CONTROL" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void stopAi()}
                  >
                    Return control
                  </Button>
                ) : null}
              </div>
            </div>
          </aside>
        ) : null}
      </div>
      <section className="grid gap-4 border-t border-slate-200 bg-white p-4 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-bold text-slate-900">
            Capability summary
          </h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {capabilities.map(capability => (
              <span
                key={capability}
                className={`rounded-full px-2.5 py-1 text-xs ${readyCapabilities.includes(capability) ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}`}
              >
                {capability} ·{" "}
                {readyCapabilities.includes(capability)
                  ? "Ready"
                  : authenticationState === "AUTHENTICATED"
                    ? "Testing"
                    : "Unavailable"}
              </span>
            ))}
          </div>
        </div>
        <div>
          <h3 className="text-sm font-bold text-slate-900">
            Latest CRM activity
          </h3>
          <ul className="mt-2 space-y-1 text-xs text-slate-600">
            {activity.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        </div>
      </section>
      <div className="sr-only" aria-live="polite">
        {control === "HUMAN_CONTROL"
          ? "You currently control the CRM."
          : status}
      </div>
    </div>
  );
}

function NoBrowserCrm({ onConnections }: { onConnections: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <MonitorUp className="mx-auto h-8 w-8 text-slate-400" />
      <h2 className="mt-4 text-lg font-bold text-slate-900">
        Connect a browser CRM to work here
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
        Once your CRM connection is ready, you can use its actual secured
        browser session alongside Amarktai.
      </p>
      <Button className="mt-5" onClick={onConnections}>
        Open connections
      </Button>
    </div>
  );
}
