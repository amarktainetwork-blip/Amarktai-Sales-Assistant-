import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { friendlyError } from "@/lib/friendlyError";
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  ChevronDown,
  Circle,
  ExternalLink,
  Grip,
  Home,
  Loader2,
  LockKeyhole,
  LogIn,
  Maximize2,
  MousePointer2,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation, useRoute } from "wouter";

type ViewerReady = {
  viewerSessionId: string;
  viewerToken: string;
  streamPath: string;
  expiresAt: string;
  control: string;
  url: string;
};

type FrameMetadata = {
  deviceWidth?: number;
  deviceHeight?: number;
};

type BrowserInputEvent =
  | {
      kind: "mouse";
      type: "mousePressed" | "mouseReleased" | "mouseMoved" | "mouseWheel";
      x: number;
      y: number;
      button?: "none" | "left" | "middle" | "right";
      clickCount?: number;
      deltaX?: number;
      deltaY?: number;
    }
  | {
      kind: "key";
      type: "keyDown" | "keyUp" | "char";
      key?: string;
      code?: string;
      text?: string;
      modifiers?: number;
    };

type BrowserNavigationAction = "back" | "forward" | "refresh";

type StreamMessage =
  | { type: "ready"; url: string; control: string; expiresAt: string }
  | { type: "frame"; data: string; url: string; metadata?: FrameMetadata }
  | { type: "navigation"; url: string }
  | { type: "control"; control: string; message?: string }
  | { type: "pong"; expiresAt?: string }
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
  const utils = trpc.useUtils();
  const canManage =
    organisation.data?.role === "owner" ||
    organisation.data?.role === "manager";
  const companySetup = trpc.companySetup.get.useQuery(undefined, {
    enabled: Boolean(canManage),
    retry: false,
  });
  const completeOnboarding = trpc.organisation.updateOnboarding.useMutation();
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
  const [browserAuthenticationState, setBrowserAuthenticationState] =
    useState("STARTING");
  const [commissioningReady, setCommissioningReady] = useState(false);
  const completionAttemptedRef = useRef(false);
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

  const onboarding = organisation.data?.settings?.onboarding;
  const onboardingComplete = Boolean(
    onboarding &&
      typeof onboarding === "object" &&
      !Array.isArray(onboarding) &&
      (onboarding as { complete?: unknown }).complete === true
  );

  useEffect(() => {
    setCommissioningReady(false);
    setBrowserAuthenticationState("STARTING");
    completionAttemptedRef.current = false;
    if (!selected || !canManage || onboardingComplete) return;
    let cancelled = false;
    const check = async () => {
      const response = await fetch(
        `/api/connected-system-admin/${selected.id}/commissioning`,
        { credentials: "include" }
      );
      if (!response.ok || cancelled) return;
      const body = (await response.json().catch(() => ({}))) as {
        job?: { state?: string; status?: string } | null;
      };
      setCommissioningReady(
        body.job?.state === "READY" && body.job?.status === "ready"
      );
    };
    void check();
    const timer = window.setInterval(() => void check(), 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [canManage, onboardingComplete, selected]);

  useEffect(() => {
    if (
      !canManage ||
      onboardingComplete ||
      completionAttemptedRef.current ||
      browserAuthenticationState !== "AUTHENTICATED" ||
      !commissioningReady ||
      companySetup.data?.profile?.discoveryStatus !== "confirmed"
    )
      return;
    completionAttemptedRef.current = true;
    void completeOnboarding
      .mutateAsync({ step: 4, complete: true })
      .then(async () => {
        await utils.organisation.current.invalidate();
        toast.success("Setup complete. Your AmarktAI workspace is ready.");
        navigate("/assistant");
      })
      .catch(error => {
        completionAttemptedRef.current = false;
        toast.error(
          friendlyError(
            error,
            "CRM commissioning is not fully proven yet, or completion could not be saved. Finish the required CRM operations and try again."
          )
        );
      });
  }, [
    browserAuthenticationState,
    canManage,
    companySetup.data?.profile?.discoveryStatus,
    completeOnboarding,
    onboardingComplete,
    navigate,
    commissioningReady,
    utils.organisation.current,
  ]);

  return (
    <DashboardLayout>
      <div
        data-crm-workspace-root
        className="h-[calc(100vh-66px)] min-h-0 overflow-hidden bg-[#EDF2F7]"
      >
        <style>{`
          main:has(> [data-crm-workspace-root]) {
            height: calc(100vh - 66px) !important;
            min-height: 0 !important;
            overflow: hidden !important;
            padding: 0 !important;
          }
          main:has(> [data-crm-workspace-root]) > div:not([data-crm-workspace-root]) {
            display: none !important;
          }
        `}</style>

        {selected ? (
          <LiveWorkspace
            key={selected.id}
            connectedSystemId={selected.id}
            crmName={selected.displayName}
            systems={systems.data ?? []}
            onChoose={id => navigate(`/crm/${id}`)}
            onToday={() => navigate("/today")}
            onAuthenticationState={setBrowserAuthenticationState}
          />
        ) : (
          <NoBrowserCrm onConnections={() => navigate("/connections")} />
        )}
      </div>
    </DashboardLayout>
  );
}

function LiveWorkspace({
  connectedSystemId,
  crmName,
  systems,
  onChoose,
  onToday,
  onAuthenticationState,
}: {
  connectedSystemId: number;
  crmName: string;
  systems: Array<{ id: number; displayName: string; baseUrl?: string | null }>;
  onChoose: (id: number) => void;
  onToday: () => void;
  onAuthenticationState: (state: string) => void;
}) {
  const open = trpc.crmViewer.open.useMutation();
  const acquireAi = trpc.crmViewer.acquireAssistantControl.useMutation();
  const releaseAi = trpc.crmViewer.releaseAssistantControl.useMutation();
  const askAssistant = trpc.crmViewer.askAssistant.useMutation();

  const [session, setSession] = useState<ViewerReady | null>(null);
  const [control, setControl] = useState("IDLE");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [image, setImage] = useState("");
  const [frameMetadata, setFrameMetadata] = useState<FrameMetadata | null>(
    null
  );
  const [status, setStatus] = useState("Opening your CRM…");
  const [currentUrl, setCurrentUrl] = useState("");
  const [authenticationState, setAuthenticationState] = useState("STARTING");
  const [assistantPrompt, setAssistantPrompt] = useState("");
  const [assistantResult, setAssistantResult] = useState<string | null>(null);
  const [assistantWorkflowRunId, setAssistantWorkflowRunId] = useState<number | null>(null);
  const [activity, setActivity] = useState<string[]>([
    "Secure CRM workspace opened",
  ]);

  const viewerRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const controlRef = useRef(control);
  const pendingInputsRef = useRef<BrowserInputEvent[]>([]);
  const pendingNavigationRef = useRef<BrowserNavigationAction | null>(null);
  const humanControlRequestedRef = useRef(false);
  const pendingAiControlRef = useRef(false);
  const lastPointerMoveAtRef = useRef(0);

  useEffect(() => {
    controlRef.current = control;
  }, [control]);

  const send = (payload: unknown) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) return false;
    socketRef.current.send(JSON.stringify(payload));
    return true;
  };

  const openViewer = async (forceReconnect = false) => {
    try {
      socketRef.current?.close(1000, "Replacing CRM viewer session");
      socketRef.current = null;
      pendingInputsRef.current = [];
      pendingNavigationRef.current = null;
      humanControlRequestedRef.current = false;
      pendingAiControlRef.current = false;
      setSession(null);
      setImage("");
      setFrameMetadata(null);
      setStatus("Opening your CRM…");
      const next = await open.mutateAsync({
        connectedSystemId,
        forceReconnect,
      });
      setSession(next);
      setControl(next.control);
      controlRef.current = next.control;
      setCurrentUrl(next.url);
    } catch (error) {
      setStatus(friendlyError(error, "The CRM workspace could not be opened."));
    }
  };

  useEffect(() => {
    void openViewer();
    return () => socketRef.current?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedSystemId]);

  const requestHumanControl = () => {
    if (controlRef.current === "AGENT_CONTROL") return;
    if (humanControlRequestedRef.current) return;
    humanControlRequestedRef.current = true;
    if (!send({ type: "acquireHumanControl" }))
      humanControlRequestedRef.current = false;
  };

  const queueOrSendInput = (event: BrowserInputEvent) => {
    if (controlRef.current === "AGENT_CONTROL") {
      if (!(event.kind === "mouse" && event.type === "mouseMoved"))
        toast.info(
          "AmarktAI is working in the CRM. Take control to work manually."
        );
      return;
    }
    if (controlRef.current === "HUMAN_CONTROL") {
      send({ type: "input", event });
      return;
    }

    if (event.kind === "mouse" && event.type === "mouseMoved") {
      pendingInputsRef.current = pendingInputsRef.current.filter(
        pending => !(pending.kind === "mouse" && pending.type === "mouseMoved")
      );
    }
    pendingInputsRef.current.push(event);
    if (pendingInputsRef.current.length > 12)
      pendingInputsRef.current.splice(0, pendingInputsRef.current.length - 12);
    requestHumanControl();
  };

  const flushPendingInput = () => {
    const queued = pendingInputsRef.current.splice(0);
    for (const event of queued) send({ type: "input", event });
  };

  const flushPendingNavigation = () => {
    const action = pendingNavigationRef.current;
    pendingNavigationRef.current = null;
    if (action) send({ type: "navigation", action });
  };

  const actuallyRequestAiControl = async () => {
    if (!session) return;
    pendingAiControlRef.current = false;
    try {
      await acquireAi.mutateAsync({ viewerSessionId: session.viewerSessionId });
    } catch (error) {
      toast.error(
        friendlyError(error, "AmarktAI could not take CRM control right now.")
      );
    }
  };

  useEffect(() => {
    if (!session) return;
    const socket = new WebSocket(streamUrl(session));
    socketRef.current = socket;

    const sendSize = () => {
      const rect = viewerRef.current?.getBoundingClientRect();
      if (!rect || socket.readyState !== WebSocket.OPEN) return;
      const viewport = crmDesktopViewport({
        width: rect.width,
        height: rect.height,
      });
      socket.send(
        JSON.stringify({
          type: "resize",
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: 1,
        })
      );
    };

    socket.onopen = () => {
      setStatus("CRM ready for sign-in");
      sendSize();
    };

    socket.onmessage = event => {
      const message = JSON.parse(String(event.data)) as StreamMessage;

      if (message.type === "frame") {
        setImage(`data:image/jpeg;base64,${message.data}`);
        setFrameMetadata(message.metadata ?? null);
      } else if (message.type === "control") {
        setControl(message.control);
        controlRef.current = message.control;
        if (message.message) setStatus(message.message);
        if (message.control === "HUMAN_CONTROL") {
          humanControlRequestedRef.current = false;
          flushPendingNavigation();
          flushPendingInput();
        }
        if (message.control === "IDLE" && pendingAiControlRef.current)
          void actuallyRequestAiControl();
      } else if (message.type === "ready") {
        setCurrentUrl(message.url);
        setControl(message.control);
        controlRef.current = message.control;
        setStatus("CRM ready");
        sendSize();
      } else if (message.type === "navigation") {
        setCurrentUrl(message.url);
      } else if (message.type === "session") {
        setCurrentUrl(message.currentUrl);
        setAuthenticationState(message.authenticationState);
        onAuthenticationState(message.authenticationState);
        if (message.errorMessage) setStatus(message.errorMessage);
        else if (message.authenticationState === "AUTHENTICATED")
          setStatus("Signed in — CRM ready");
        else if (message.authenticationState === "LOGIN_REQUIRED")
          setStatus("Sign in directly to your CRM");
      } else if (message.type === "error") {
        setStatus(message.message || "CRM session needs attention");
      } else if (message.type === "disconnected") {
        setStatus(message.message);
      }
    };

    socket.onerror = () => setStatus("CRM connection needs attention");
    socket.onclose = () => {
      if (socketRef.current === socket) socketRef.current = null;
    };

    const observer = new ResizeObserver(sendSize);
    if (viewerRef.current) observer.observe(viewerRef.current);
    const ping = window.setInterval(() => send({ type: "ping" }), 15_000);
    return () => {
      observer.disconnect();
      window.clearInterval(ping);
      socket.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.viewerSessionId]);

  useEffect(() => {
    if (control !== "HUMAN_CONTROL") return;
    flushPendingNavigation();
    flushPendingInput();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [control]);

  const navigateBrowser = (action: BrowserNavigationAction) => {
    if (controlRef.current === "AGENT_CONTROL") {
      toast.info("AmarktAI is working in the CRM. Take control first.");
      return;
    }
    if (controlRef.current === "HUMAN_CONTROL") {
      send({ type: "navigation", action });
      return;
    }
    pendingNavigationRef.current = action;
    requestHumanControl();
  };

  const handlePointer = (
    event: React.PointerEvent<HTMLDivElement>,
    type: "mousePressed" | "mouseReleased" | "mouseMoved"
  ) => {
    if (!frameMetadata?.deviceWidth || !frameMetadata?.deviceHeight) return;
    if (type === "mouseMoved") {
      const now = performance.now();
      if (now - lastPointerMoveAtRef.current < 35) return;
      lastPointerMoveAtRef.current = now;
    }
    const rect = viewerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.max(
      0,
      Math.min(
        frameMetadata.deviceWidth,
        ((event.clientX - rect.left) / rect.width) * frameMetadata.deviceWidth
      )
    );
    const y = Math.max(
      0,
      Math.min(
        frameMetadata.deviceHeight,
        ((event.clientY - rect.top) / rect.height) * frameMetadata.deviceHeight
      )
    );
    queueOrSendInput({
      kind: "mouse",
      type,
      x,
      y,
      button: type === "mouseMoved" ? "none" : "left",
      clickCount: type === "mouseMoved" ? 0 : 1,
    });
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!frameMetadata?.deviceWidth || !frameMetadata?.deviceHeight) return;
    const rect = viewerRef.current?.getBoundingClientRect();
    if (!rect) return;
    queueOrSendInput({
      kind: "mouse",
      type: "mouseWheel",
      x:
        ((event.clientX - rect.left) / rect.width) * frameMetadata.deviceWidth,
      y:
        ((event.clientY - rect.top) / rect.height) * frameMetadata.deviceHeight,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      button: "none",
    });
  };

  const handleKey = (
    event: React.KeyboardEvent<HTMLDivElement>,
    type: "keyDown" | "keyUp"
  ) => {
    if (event.key === "Tab" || event.key === "Backspace") event.preventDefault();
    queueOrSendInput({
      kind: "key",
      type,
      key: event.key,
      code: event.code,
      text: type === "keyDown" && event.key.length === 1 ? event.key : undefined,
      modifiers:
        (event.altKey ? 1 : 0) |
        (event.ctrlKey ? 2 : 0) |
        (event.metaKey ? 4 : 0) |
        (event.shiftKey ? 8 : 0),
    });
  };

  const giveAiControl = async () => {
    if (!session) return;
    pendingInputsRef.current = [];
    pendingNavigationRef.current = null;
    if (controlRef.current === "HUMAN_CONTROL") {
      pendingAiControlRef.current = true;
      send({ type: "releaseHumanControl" });
      return;
    }
    await actuallyRequestAiControl();
  };

  const giveHumanControl = async () => {
    if (!session) return;
    pendingAiControlRef.current = false;
    try {
      await releaseAi.mutateAsync({ viewerSessionId: session.viewerSessionId });
    } catch (error) {
      toast.error(friendlyError(error, "CRM control could not be returned."));
    }
  };

  const askAboutPage = async () => {
    if (!session || !assistantPrompt.trim()) return;
    try {
      const result = await askAssistant.mutateAsync({
        viewerSessionId: session.viewerSessionId,
        command: assistantPrompt.trim(),
      });
      setAssistantResult(result.response.content);
      setAssistantWorkflowRunId(result.workflowRunId);
      setActivity(current => [
        `AmarktAI analysed the current CRM page`,
        ...current.slice(0, 7),
      ]);
    } catch (error) {
      toast.error(
        friendlyError(error, "AmarktAI could not analyse this CRM page.")
      );
    }
  };

  const authenticated = authenticationState === "AUTHENTICATED";
  const humanControl = control === "HUMAN_CONTROL";
  const agentControl = control === "AGENT_CONTROL";

  return (
    <div className="grid h-full min-h-0 grid-rows-[54px_1fr] overflow-hidden">
      <header className="flex min-w-0 items-center justify-between gap-3 border-b border-[#D4DEE9] bg-white px-3 shadow-sm sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onToday}
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-[#D9E2ED] text-[#617188] hover:bg-[#F2F6FA]"
            aria-label="Back to AmarktAI"
          >
            <Home size={15} />
          </button>
          <div className="min-w-0">
            <p className="truncate text-xs font-black uppercase tracking-[.08em] text-[#2F6FED]">
              Source CRM
            </p>
            <p className="truncate text-sm font-bold text-[#2C3D53]">
              {crmName}
            </p>
          </div>
          {systems.length > 1 ? (
            <label className="relative hidden sm:block">
              <select
                value={connectedSystemId}
                onChange={event => onChoose(Number(event.target.value))}
                className="h-8 appearance-none rounded-lg border border-[#D9E2ED] bg-white pl-3 pr-8 text-xs font-bold text-[#52647A] outline-none"
                aria-label="Choose CRM"
              >
                {systems.map(system => (
                  <option key={system.id} value={system.id}>
                    {system.displayName}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-2 size-4 text-[#7B8798]" />
            </label>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`hidden rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[.05em] sm:inline-flex ${
              authenticated
                ? "bg-emerald-50 text-emerald-700"
                : "bg-amber-50 text-amber-700"
            }`}
          >
            {authenticated ? "Signed in" : "Sign-in required"}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void openViewer(true)}
            disabled={open.isPending}
          >
            <RotateCcw className="mr-2 h-3.5 w-3.5" />
            Reconnect
          </Button>
          {humanControl ? (
            <Button size="sm" onClick={() => void giveAiControl()}>
              <Bot className="mr-2 h-3.5 w-3.5" /> Give control to AmarktAI
            </Button>
          ) : agentControl ? (
            <Button size="sm" variant="outline" onClick={() => void giveHumanControl()}>
              <MousePointer2 className="mr-2 h-3.5 w-3.5" /> Take control
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={requestHumanControl}>
              <MousePointer2 className="mr-2 h-3.5 w-3.5" /> Take control
            </Button>
          )}
        </div>
      </header>

      <div className="grid min-h-0 grid-cols-1 overflow-hidden xl:grid-cols-[1fr_330px]">
        <section className="relative flex min-h-0 flex-col overflow-hidden bg-[#D9E3EE]">
          <div className="flex h-10 shrink-0 items-center gap-1 border-b border-[#C9D4E1] bg-[#EEF3F7] px-2">
            <button
              type="button"
              onClick={() => navigateBrowser("back")}
              className="grid size-7 place-items-center rounded-md text-[#607086] hover:bg-white"
              aria-label="Back"
            >
              <ArrowLeft size={14} />
            </button>
            <button
              type="button"
              onClick={() => navigateBrowser("forward")}
              className="grid size-7 place-items-center rounded-md text-[#607086] hover:bg-white"
              aria-label="Forward"
            >
              <ArrowRight size={14} />
            </button>
            <button
              type="button"
              onClick={() => navigateBrowser("refresh")}
              className="grid size-7 place-items-center rounded-md text-[#607086] hover:bg-white"
              aria-label="Refresh"
            >
              <RefreshCw size={14} />
            </button>
            <div className="ml-1 flex h-7 min-w-0 flex-1 items-center rounded-md border border-[#D4DEE9] bg-white px-2 text-[10px] font-medium text-[#7B8798]">
              <LockKeyhole className="mr-1.5 size-3 shrink-0 text-emerald-600" />
              <span className="truncate">{currentUrl || "Secure CRM session"}</span>
            </div>
            <button
              type="button"
              onClick={() => setAssistantOpen(value => !value)}
              className={`ml-1 grid size-7 place-items-center rounded-md ${assistantOpen ? "bg-[#2F6FED] text-white" : "text-[#607086] hover:bg-white"}`}
              aria-label="AmarktAI page assistant"
            >
              <Sparkles size={14} />
            </button>
          </div>

          <div
            ref={viewerRef}
            role="application"
            aria-label={`${crmName} secure browser`}
            tabIndex={0}
            onPointerDown={event => handlePointer(event, "mousePressed")}
            onPointerUp={event => handlePointer(event, "mouseReleased")}
            onPointerMove={event => handlePointer(event, "mouseMoved")}
            onWheel={handleWheel}
            onKeyDown={event => handleKey(event, "keyDown")}
            onKeyUp={event => handleKey(event, "keyUp")}
            className={`relative min-h-0 flex-1 overflow-hidden outline-none ${humanControl ? "cursor-default" : agentControl ? "cursor-not-allowed" : "cursor-pointer"}`}
          >
            {image ? (
              <img
                src={image}
                alt={`${crmName} live workspace`}
                draggable={false}
                className="h-full w-full select-none object-contain"
              />
            ) : (
              <div className="grid h-full place-items-center bg-[#E7EDF4] text-center">
                <div>
                  <Loader2 className="mx-auto h-7 w-7 animate-spin text-[#2F6FED]" />
                  <p className="mt-3 text-sm font-bold text-[#52647A]">{status}</p>
                </div>
              </div>
            )}
            {agentControl ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-4 mx-auto w-max rounded-full border border-[#BBD0F3] bg-white/95 px-4 py-2 text-xs font-bold text-[#2F63C7] shadow-lg backdrop-blur">
                <Bot className="mr-2 inline h-3.5 w-3.5" />
                AmarktAI has CRM control
              </div>
            ) : null}
          </div>

          <div className="flex min-h-9 shrink-0 items-center justify-between gap-2 border-t border-[#C9D4E1] bg-[#EEF3F7] px-3 text-[10px] font-semibold text-[#6B7A8D]">
            <span className="truncate">{status}</span>
            <span className="flex shrink-0 items-center gap-1.5">
              <ShieldCheck className="size-3.5 text-emerald-600" /> Private session
            </span>
          </div>

          {assistantOpen ? (
            <div className="absolute bottom-12 right-3 z-20 w-[min(400px,calc(100%-24px))] rounded-2xl border border-[#D3DEEA] bg-white p-4 shadow-2xl">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="grid size-8 place-items-center rounded-lg bg-[#EAF1FF] text-[#2F6FED]">
                    <Sparkles size={15} />
                  </span>
                  <div>
                    <p className="text-xs font-black text-[#26354A]">Ask AmarktAI</p>
                    <p className="text-[10px] text-[#7B8798]">About this CRM page</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setAssistantOpen(false)}
                  className="grid size-7 place-items-center rounded-md text-[#7B8798] hover:bg-[#F2F5F8]"
                  aria-label="Close assistant"
                >
                  <Circle size={14} />
                </button>
              </div>
              <textarea
                value={assistantPrompt}
                onChange={event => setAssistantPrompt(event.target.value)}
                placeholder="What should I know about this page?"
                className="mt-3 min-h-20 w-full resize-none rounded-xl border border-[#D4DEE9] p-3 text-sm text-[#33445B] outline-none focus:border-[#91ACE0]"
              />
              <Button
                size="sm"
                className="mt-2 w-full"
                disabled={!assistantPrompt.trim() || askAssistant.isPending}
                onClick={() => void askAboutPage()}
              >
                {askAssistant.isPending ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="mr-2 h-3.5 w-3.5" />
                )}
                Ask
              </Button>
              {assistantResult ? (
                <div className="mt-3 rounded-xl bg-[#F4F7FB] p-3 text-xs leading-5 text-[#52647A]">
                  <p className="whitespace-pre-wrap">{assistantResult}</p>
                  {assistantWorkflowRunId ? (
                    <button
                      type="button"
                      onClick={() => window.location.assign("/reviews")}
                      className="mt-2 font-bold text-[#2F6FED] hover:underline"
                    >
                      Open Review
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <aside className="hidden min-h-0 flex-col border-l border-[#D4DEE9] bg-white xl:flex">
          <div className="border-b border-[#E5EAF0] p-4">
            <p className="text-[10px] font-black uppercase tracking-[.12em] text-[#2F6FED]">
              AmarktAI context
            </p>
            <h2 className="mt-1 font-display text-xl font-bold tracking-[-.035em] text-[#26354A]">
              Source CRM workspace
            </h2>
            <p className="mt-2 text-xs leading-5 text-[#708096]">
              Use this view for sign-in, specialist work and recovery. Daily customer work should happen in AmarktAI.
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="rounded-xl border border-[#E0E7EF] bg-[#F8FAFC] p-3">
              <p className="text-[10px] font-black uppercase text-[#8390A2]">
                Session
              </p>
              <p className="mt-1 text-xs font-bold text-[#33445B]">
                {authenticated ? "Authenticated" : "Sign-in required"}
              </p>
              <p className="mt-1 break-all text-[10px] leading-4 text-[#7B8798]">
                {currentUrl || "Waiting for CRM"}
              </p>
            </div>
            <div className="mt-4 space-y-2">
              {activity.map((item, index) => (
                <div
                  key={`${item}-${index}`}
                  className="flex gap-2 rounded-xl border border-[#E5EAF0] bg-white p-3"
                >
                  <Grip className="mt-0.5 size-3.5 shrink-0 text-[#A2AEBE]" />
                  <p className="text-[11px] leading-5 text-[#607086]">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function NoBrowserCrm({ onConnections }: { onConnections: () => void }) {
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="max-w-md rounded-3xl border border-[#D4DEE9] bg-white p-7 text-center shadow-sm">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[#EAF1FF] text-[#2F6FED]">
          <LogIn size={22} />
        </span>
        <h2 className="mt-4 font-display text-2xl font-bold tracking-[-.04em] text-[#26354A]">
          Connect the company CRM first
        </h2>
        <p className="mt-2 text-sm leading-6 text-[#708096]">
          A manager needs to connect the source CRM before this secure workspace can open.
        </p>
        <Button className="mt-5" onClick={onConnections}>
          Open CRM setup
        </Button>
      </div>
    </div>
  );
}

export function crmDesktopViewport(input: { width: number; height: number }) {
  const width = Math.round(Math.max(960, Math.min(1920, input.width)));
  const height = Math.round(Math.max(640, Math.min(1200, input.height)));
  return { width, height };
}
