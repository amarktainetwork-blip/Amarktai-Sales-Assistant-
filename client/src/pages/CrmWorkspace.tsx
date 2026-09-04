import DashboardLayout from "@/components/DashboardLayout";
import InlineCrmReview from "@/components/InlineCrmReview";
import { Button } from "@/components/ui/button";
import {
  crmDesktopViewport,
  normalizeCrmWheelDelta,
} from "@/lib/crmViewerInput";
import { friendlyError } from "@/lib/friendlyError";
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  Globe2,
  Loader2,
  MonitorUp,
  MousePointer2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import { toast } from "sonner";
import { useLocation, useRoute } from "wouter";

type ViewerReady = {
  viewerSessionId: string;
  viewerToken: string;
  expiresAt: string;
  url: string;
  control: string;
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
        toast.success("Setup complete. Your Assistant is ready.");
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

        if (message.control === "HUMAN_CONTROL") {
          humanControlRequestedRef.current = false;
          flushPendingInput();
          flushPendingNavigation();
        } else if (message.control === "IDLE") {
          humanControlRequestedRef.current = false;
          if (pendingAiControlRef.current) void actuallyRequestAiControl();
          else if (
            pendingInputsRef.current.length ||
            pendingNavigationRef.current
          )
            requestHumanControl();
        } else if (message.control === "AGENT_CONTROL") {
          humanControlRequestedRef.current = false;
          pendingInputsRef.current = [];
          pendingNavigationRef.current = null;
        }

        setActivity(current =>
          [
            `${
              message.control === "HUMAN_CONTROL"
                ? "You took CRM control"
                : message.control === "AGENT_CONTROL"
                  ? "AmarktAI took CRM control"
                  : "CRM control is idle"
            } · ${new Date().toLocaleTimeString()}`,
            ...current,
          ].slice(0, 8)
        );
      } else if (message.type === "ready") {
        setControl(message.control);
        controlRef.current = message.control;
        setCurrentUrl(message.url);
      } else if (message.type === "navigation") {
        setCurrentUrl(message.url);
      } else if (message.type === "session") {
        setCurrentUrl(message.currentUrl);
        setAuthenticationState(message.authenticationState);
        onAuthenticationState(message.authenticationState);
        setStatus(
          message.errorMessage ||
            (message.authenticationState === "AUTHENTICATED"
              ? "Connected"
              : message.authenticationState === "CHECKING"
                ? "Checking your sign-in…"
                : message.authenticationState === "MFA_OR_SSO"
                  ? "Complete verification in the CRM"
                  : message.authenticationState === "REAUTHENTICATION_REQUIRED"
                    ? "Sign in again"
                    : "Sign in directly to your CRM")
        );

        if (message.authenticationState === "AUTHENTICATED")
          setActivity(current =>
            current[0]?.startsWith("CRM authenticated")
              ? current
              : [
                  `CRM authenticated · ${new Date().toLocaleTimeString()}`,
                  ...current,
                ].slice(0, 8)
          );
      } else if (message.type === "disconnected") {
        setStatus("The CRM browser connection paused. Reopen it to continue.");
      } else if (message.type === "error") {
        const friendly = friendlyError(
          message.message || message.code,
          "That CRM action could not be completed."
        );
        setStatus(friendly);
        toast.error(friendly);
      }
    };

    socket.onclose = event => {
      setStatus(
        event.code === 4002
          ? "This CRM was disconnected. Reconnect it from Connections to continue."
          : "Connection paused. Reconnect to continue."
      );
      pendingInputsRef.current = [];
      pendingNavigationRef.current = null;
      humanControlRequestedRef.current = false;
    };

    const observer = new ResizeObserver(sendSize);
    if (viewerRef.current) observer.observe(viewerRef.current);
    const heartbeat = window.setInterval(() => {
      if (socket.readyState === WebSocket.OPEN && !document.hidden)
        socket.send(JSON.stringify({ type: "ping" }));
    }, 25_000);

    return () => {
      window.clearInterval(heartbeat);
      observer.disconnect();
      socket.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    const onVisibility = () =>
      send({ type: "visibility", visible: !document.hidden });
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility();
    return () => document.removeEventListener("visibilitychange", onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const mapPointer = (clientX: number, clientY: number) => {
    const rect = viewerRef.current?.getBoundingClientRect();
    if (!rect) return null;

    const sourceWidth =
      frameMetadata?.deviceWidth && frameMetadata.deviceWidth > 0
        ? frameMetadata.deviceWidth
        : rect.width;
    const sourceHeight =
      frameMetadata?.deviceHeight && frameMetadata.deviceHeight > 0
        ? frameMetadata.deviceHeight
        : rect.height;

    const scale = Math.min(
      rect.width / sourceWidth,
      rect.height / sourceHeight
    );
    const renderedWidth = sourceWidth * scale;
    const renderedHeight = sourceHeight * scale;
    const offsetX = (rect.width - renderedWidth) / 2;
    const offsetY = (rect.height - renderedHeight) / 2;
    const localX = clientX - rect.left - offsetX;
    const localY = clientY - rect.top - offsetY;

    if (
      localX < 0 ||
      localY < 0 ||
      localX > renderedWidth ||
      localY > renderedHeight
    )
      return null;

    return {
      x: localX / scale,
      y: localY / scale,
    };
  };

  const forwardPointer = (
    event: PointerEvent<HTMLDivElement>,
    type: "mousePressed" | "mouseReleased" | "mouseMoved"
  ) => {
    if (type === "mouseMoved") {
      if (controlRef.current === "AGENT_CONTROL") return;
      const now = performance.now();
      if (now - lastPointerMoveAtRef.current < 30) return;
      lastPointerMoveAtRef.current = now;
    }
    const point = mapPointer(event.clientX, event.clientY);
    if (!point) return;
    if (type === "mousePressed")
      viewerRef.current?.focus({ preventScroll: true });
    queueOrSendInput({
      kind: "mouse",
      type,
      ...point,
      button:
        event.button === 2
          ? "right"
          : event.button === 1
            ? "middle"
            : event.button === 0
              ? "left"
              : "none",
      clickCount: Math.max(1, event.detail || 1),
    });
  };

  const forwardWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const point = mapPointer(event.clientX, event.clientY);
    const rect = viewerRef.current?.getBoundingClientRect();
    if (!point || !rect) return;
    queueOrSendInput({
      kind: "mouse",
      type: "mouseWheel",
      ...point,
      deltaX: normalizeCrmWheelDelta(event.deltaX, event.deltaMode, rect.width),
      deltaY: normalizeCrmWheelDelta(
        event.deltaY,
        event.deltaMode,
        rect.height
      ),
    });
  };

  const forwardKey = (
    event: KeyboardEvent<HTMLDivElement>,
    type: "keyDown" | "keyUp"
  ) => {
    const commandKey = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();

    // Keep browser/app-level shortcuts outside the remote page. Paste is the
    // exception: allow the browser to emit the ClipboardEvent, which is then
    // forwarded through the bounded Input.insertText path below.
    if (commandKey && ["l", "r", "t", "n", "q", "w"].includes(key)) return;
    if (commandKey && key === "v") return;

    event.preventDefault();
    const modifiers =
      (event.altKey ? 1 : 0) |
      (event.ctrlKey ? 2 : 0) |
      (event.metaKey ? 4 : 0) |
      (event.shiftKey ? 8 : 0);

    queueOrSendInput({
      kind: "key",
      type,
      key: event.key,
      code: event.code,
      text:
        type === "keyDown" &&
        event.key.length === 1 &&
        !event.ctrlKey &&
        !event.metaKey
          ? event.key
          : "",
      modifiers,
    });
  };

  const forwardPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData("text").slice(0, 4_000);
    if (!text) return;
    queueOrSendInput({
      kind: "key",
      type: "keyDown",
      key: "",
      code: "",
      text,
      modifiers: 0,
    });
  };

  const takeControl = async () => {
    try {
      if (controlRef.current === "AGENT_CONTROL" && session) {
        await releaseAi.mutateAsync({
          viewerSessionId: session.viewerSessionId,
        });
        // The mutation has synchronously released the server arbitration lock.
        // Do not wait on a websocket IDLE frame before asking for human control.
        controlRef.current = "IDLE";
        setControl("IDLE");
        humanControlRequestedRef.current = false;
      }
      requestHumanControl();
      viewerRef.current?.focus({ preventScroll: true });
    } catch (error) {
      toast.error(
        friendlyError(error, "CRM control could not be returned to you.")
      );
    }
  };

  const requestAi = () => {
    if (!session || controlRef.current === "AGENT_CONTROL") return;
    pendingAiControlRef.current = true;
    pendingNavigationRef.current = null;
    if (controlRef.current === "HUMAN_CONTROL")
      send({ type: "releaseHumanControl" });
    else void actuallyRequestAiControl();
  };

  const navigateBrowser = (action: BrowserNavigationAction) => {
    if (controlRef.current === "AGENT_CONTROL") {
      toast.info(
        "AmarktAI is working in the CRM. Take control before navigating."
      );
      return;
    }
    if (controlRef.current === "HUMAN_CONTROL") {
      send({ type: "navigation", action });
      return;
    }
    pendingNavigationRef.current = action;
    requestHumanControl();
  };

  const confirmSignedIn = () => send({ type: "customerFinishedSigningIn" });

  const submitAssistant = async () => {
    if (!session || !assistantPrompt.trim()) return;
    try {
      setAssistantWorkflowRunId(null);
      const result = await askAssistant.mutateAsync({
        viewerSessionId: session.viewerSessionId,
        command: assistantPrompt.trim(),
      });
      setAssistantResult(result.summary);
      setAssistantWorkflowRunId(
        typeof result.workflowRunId === "number" ? result.workflowRunId : null
      );
      setAssistantPrompt("");
    } catch (error) {
      setAssistantWorkflowRunId(null);
      setAssistantResult(
        friendlyError(error, "AmarktAI could not complete that request.")
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

  const authReady = authenticationState === "AUTHENTICATED";
  const availableSystems = systems.filter(system => system.baseUrl);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[#D7E0EA] bg-[#F7F9FC] px-2.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-[#526277]"
          onClick={onToday}
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          <span className="hidden xl:inline">Today</span>
        </Button>

        <div className="h-6 w-px bg-[#D7E0EA]" />

        <div className="flex items-center gap-0.5">
          <Button
            aria-label="Back"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => navigateBrowser("back")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button
            aria-label="Forward"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => navigateBrowser("forward")}
          >
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button
            aria-label="Refresh CRM"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => navigateBrowser("refresh")}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-[#D7E0EA] bg-white px-3 py-1.5 text-xs shadow-sm">
          <Globe2 className="h-3.5 w-3.5 shrink-0 text-[#3F70D8]" />
          {availableSystems.length > 1 ? (
            <select
              aria-label="Choose CRM"
              value={connectedSystemId}
              onChange={event => onChoose(Number(event.target.value))}
              className="max-w-40 bg-transparent font-bold text-[#26354A] outline-none"
            >
              {availableSystems.map(system => (
                <option key={system.id} value={system.id}>
                  {system.displayName}
                </option>
              ))}
            </select>
          ) : (
            <span className="shrink-0 font-bold text-[#26354A]">{crmName}</span>
          )}
          <span className="truncate text-[#77859A]">{domain}</span>
        </div>

        <div className="hidden min-w-0 items-center gap-2 lg:flex">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              authReady ? "bg-emerald-500" : "bg-amber-400"
            }`}
          />
          <span className="max-w-52 truncate text-xs font-semibold text-[#526277]">
            {status}
          </span>
        </div>

        <Button
          variant={assistantOpen ? "default" : "outline"}
          size="sm"
          className="h-8"
          onClick={() => setAssistantOpen(open => !open)}
        >
          <Sparkles className="mr-1.5 h-4 w-4" />
          Assistant
        </Button>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <section className="relative min-w-0 flex-1 bg-[#E9EEF5]">
          <div
            ref={viewerRef}
            role="application"
            aria-label={`${crmName} live CRM`}
            tabIndex={0}
            onPointerEnter={() => requestHumanControl()}
            onPointerDown={event => forwardPointer(event, "mousePressed")}
            onPointerUp={event => forwardPointer(event, "mouseReleased")}
            onPointerMove={event => forwardPointer(event, "mouseMoved")}
            onWheel={forwardWheel}
            onKeyDown={event => forwardKey(event, "keyDown")}
            onKeyUp={event => forwardKey(event, "keyUp")}
            onPaste={forwardPaste}
            onContextMenu={event => event.preventDefault()}
            className="relative h-full w-full cursor-default overflow-hidden bg-[#E9EEF5] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3F70D8]"
          >
            {image ? (
              <img
                src={image}
                alt=""
                aria-hidden="true"
                draggable={false}
                className="pointer-events-none h-full w-full select-none object-contain"
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-[#6C798B]">
                <Loader2 className="h-7 w-7 animate-spin text-[#3F70D8]" />
                <p className="text-sm font-semibold">{status}</p>
              </div>
            )}

            <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 rounded-full border border-white/60 bg-[#26354A]/90 px-3 py-1.5 text-[11px] font-bold text-white shadow-md backdrop-blur">
              <MousePointer2 className="h-3.5 w-3.5" />
              {control === "HUMAN_CONTROL"
                ? "You control the CRM"
                : control === "AGENT_CONTROL"
                  ? "AmarktAI is working"
                  : "Move here to take control"}
            </div>
          </div>
        </section>

        {assistantOpen ? (
          <aside className="absolute inset-y-0 right-0 z-30 flex w-[min(390px,94vw)] flex-col border-l border-[#D7E0EA] bg-white shadow-[-18px_0_45px_rgba(38,53,74,.12)] lg:relative lg:z-auto lg:w-[370px] lg:shadow-none">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-[#D7E0EA] px-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[#3F70D8]" />
                <div>
                  <p className="text-sm font-bold text-[#26354A]">
                    AmarktAI Assistant
                  </p>
                  <p className="text-[10px] font-semibold uppercase tracking-[.12em] text-emerald-600">
                    Ready
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                aria-label="Close assistant"
                onClick={() => setAssistantOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="rounded-xl border border-[#DCE7F6] bg-[#F4F8FF] p-3">
                <p className="text-xs font-bold text-[#26354A]">{status}</p>
                <p className="mt-1 text-xs leading-5 text-[#6C798B]">
                  {authReady
                    ? "Your private CRM session is connected. Ask me to work with the customer or use the CRM yourself."
                    : "Finish signing in inside the CRM. Your password and verification code stay between you and the CRM."}
                </p>
              </div>

              {assistantResult ? (
                <div className="mt-3 rounded-xl border border-[#D7E0EA] bg-white p-3 text-sm leading-6 text-[#33445B]">
                  {assistantResult}
                </div>
              ) : null}

              <InlineCrmReview workflowRunId={assistantWorkflowRunId} />

              <details className="mt-4 rounded-xl border border-[#D7E0EA] bg-white">
                <summary className="cursor-pointer list-none px-3 py-2.5 text-xs font-bold text-[#33445B]">
                  CRM controls
                </summary>
                <div className="space-y-2 border-t border-[#E5EAF0] p-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => void takeControl()}
                  >
                    <MousePointer2 className="mr-2 h-4 w-4" />
                    {control === "HUMAN_CONTROL"
                      ? "You have control"
                      : "Take control"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start"
                    onClick={requestAi}
                    disabled={
                      control === "AGENT_CONTROL" || acquireAi.isPending
                    }
                  >
                    <ShieldCheck className="mr-2 h-4 w-4" />
                    {control === "AGENT_CONTROL"
                      ? "AmarktAI has control"
                      : "Give control to AmarktAI"}
                  </Button>
                  {!authReady ? (
                    <Button
                      size="sm"
                      className="w-full justify-start"
                      onClick={confirmSignedIn}
                    >
                      Check my sign-in
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => void openViewer(true)}
                    disabled={open.isPending}
                  >
                    <RefreshCw
                      className={`mr-2 h-4 w-4 ${
                        open.isPending ? "animate-spin" : ""
                      }`}
                    />
                    Reconnect browser
                  </Button>
                </div>
              </details>

              <details className="mt-3 rounded-xl border border-[#D7E0EA] bg-white">
                <summary className="cursor-pointer list-none px-3 py-2.5 text-xs font-bold text-[#33445B]">
                  Recent CRM activity
                </summary>
                <ul className="space-y-2 border-t border-[#E5EAF0] p-3 text-xs text-[#6C798B]">
                  {activity.map((item, index) => (
                    <li key={`${item}-${index}`}>{item}</li>
                  ))}
                </ul>
              </details>
            </div>

            <div className="shrink-0 border-t border-[#D7E0EA] bg-[#FAFBFD] p-3">
              <textarea
                aria-label="Ask AmarktAI"
                value={assistantPrompt}
                onChange={event => setAssistantPrompt(event.target.value)}
                onKeyDown={event => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submitAssistant();
                  }
                }}
                className="min-h-20 w-full resize-none rounded-xl border border-[#CCD6E2] bg-white px-3 py-2 text-sm outline-none focus:border-[#3F70D8] focus:ring-2 focus:ring-[#DCE7F6]"
                placeholder="Ask AmarktAI to find a customer, prepare a call, explain history…"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[10px] text-[#8995A6]">
                  Enter to send · Shift+Enter for a new line
                </span>
                <Button
                  size="sm"
                  onClick={() => void submitAssistant()}
                  disabled={!assistantPrompt.trim() || askAssistant.isPending}
                >
                  {askAssistant.isPending ? "Working…" : "Ask"}
                </Button>
              </div>
            </div>
          </aside>
        ) : null}
      </div>

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
    <div className="grid h-full place-items-center p-6">
      <div className="max-w-md rounded-2xl border border-dashed border-[#C9D3DF] bg-white p-8 text-center shadow-sm">
        <MonitorUp className="mx-auto h-8 w-8 text-[#7A8799]" />
        <h2 className="mt-4 text-lg font-bold text-[#26354A]">
          Connect a CRM to work here
        </h2>
        <p className="mx-auto mt-2 text-sm leading-6 text-[#6C798B]">
          Connect the company CRM once. Each salesperson then signs in to their
          own private CRM workspace beside the AmarktAI Assistant.
        </p>
        <Button className="mt-5" onClick={onConnections}>
          Open connections
        </Button>
      </div>
    </div>
  );
}
