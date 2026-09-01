import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import { URL } from "node:url";
import type { CDPSession } from "playwright-core";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import {
  getConnectedSystemForUser,
  toAdapterConnection,
} from "./connectedSystems";
import { recordAudit } from "./db";
import { requireLocalHttpContext } from "./httpAuth";
import {
  acquireAiBrowserControl,
  acquireHumanBrowserControl,
  browserControlState,
  releaseBrowserControl,
  subscribeBrowserControl,
  type BrowserControlState,
} from "./browserConnectors/browserControlArbitration";
import {
  managedCrmBrowserSessionManager,
  type ManagedCrmBrowserSessionHandle,
} from "./browserConnectors/managedCrmBrowserSessionManager";

// Viewer tokens are scoped to one authenticated user + organisation + CRM.
// A normal sales session renews this inactivity window on every valid message.
const VIEWER_TTL_MS = 30 * 60_000;
const IDLE_LEASE_MS = 20_000;
const MAX_MESSAGE_BYTES = 16 * 1024;
const MAX_FRAME_BYTES = 1_600_000;
const MAX_FRAME_RATE = 20;
const MAX_VIEWERS_PER_SESSION = 1;

type ControlState = BrowserControlState;
type ViewerSocketMessage =
  | { type: "input"; event: ViewerInputEvent }
  | {
      type: "resize";
      width: number;
      height: number;
      deviceScaleFactor?: number;
    }
  | { type: "visibility"; visible: boolean }
  | { type: "releaseHumanControl" }
  | { type: "acquireHumanControl" }
  | { type: "navigation"; action: "back" | "forward" | "refresh" }
  | { type: "customerFinishedSigningIn" }
  | { type: "ping" };

type ViewerInputEvent =
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

type LiveCrmSession = {
  id: string;
  token: Buffer;
  organisationId: number;
  connectedSystemId: number;
  userId: number;
  provider: string;
  managed: ManagedCrmBrowserSessionHandle;
  cdp?: CDPSession;
  expiresAt: number;
  lastUrl: string;
  control: ControlState;
  visible: boolean;
  streaming: boolean;
  lastFrameAt: number;
  sockets: Set<WebSocket>;
  expiresTimer?: ReturnType<typeof setTimeout>;
  unsubscribeControl?: () => void;
  unsubscribeSession?: () => void;
  interactive: boolean;
};

const sessions = new Map<string, LiveCrmSession>();
const scopeIndex = new Map<string, string>();

function scopeKey(
  organisationId: number,
  connectedSystemId: number,
  userId: number
) {
  return `${organisationId}:${connectedSystemId}:${userId}`;
}

function safeEqual(left: Buffer, right: Buffer) {
  return left.length === right.length && timingSafeEqual(left, right);
}

function socketPayload(socket: WebSocket, payload: unknown) {
  if (socket.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify(payload));
}

function broadcast(session: LiveCrmSession, payload: unknown) {
  session.sockets.forEach(socket => socketPayload(socket, payload));
}

function parseMessage(raw: Buffer | ArrayBuffer | Buffer[]) {
  const text = Buffer.isBuffer(raw)
    ? raw.toString("utf8")
    : raw instanceof ArrayBuffer
      ? Buffer.from(raw).toString("utf8")
      : Buffer.concat(raw).toString("utf8");
  if (Buffer.byteLength(text, "utf8") > MAX_MESSAGE_BYTES)
    throw new Error("CRM_VIEWER_MESSAGE_TOO_LARGE");
  const value = JSON.parse(text) as ViewerSocketMessage;
  if (!value || typeof value !== "object" || !("type" in value))
    throw new Error("CRM_VIEWER_MESSAGE_INVALID");
  return value;
}

function boundedNumber(value: unknown, low: number, high: number) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= low &&
    value <= high
  );
}

function viewerMessage(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  if (/DISCONNECTED|RETIRED/i.test(detail))
    return "This CRM is disconnected. Reconnect it from Connections to continue.";
  if (/HUMAN_CONTROL_REQUIRED/i.test(detail))
    return "Take control before using browser navigation or entering information.";
  if (/AGENT_CONTROL|AI_CONTROL/i.test(detail))
    return "Amarktai is working in your CRM. Take control when it reaches a safe stopping point.";
  if (/ADDRESS_REQUIRED|START_URL_REQUIRED|URL/i.test(detail))
    return "Enter the full CRM address, including https://";
  if (/AUTH|SIGN.?IN|SESSION/i.test(detail))
    return "Your CRM needs you to sign in again.";
  if (/HOST|PATH|DOMAIN|APPROV/i.test(detail))
    return "This CRM redirected to a new sign-in service. A manager needs to approve it.";
  return "We lost the browser connection. Reopen your CRM.";
}

export function shouldForwardScreencastFrame(input: {
  visible: boolean;
  socketCount: number;
  now: number;
  lastFrameAt: number;
  bytes: number;
}) {
  return (
    input.visible &&
    input.socketCount > 0 &&
    input.bytes <= MAX_FRAME_BYTES &&
    input.now - input.lastFrameAt >= 1_000 / MAX_FRAME_RATE
  );
}

export function canAcceptBrowserInput(control: BrowserControlState) {
  return control === "HUMAN_CONTROL";
}

function assertInput(event: ViewerInputEvent) {
  if (!event || typeof event !== "object" || !("kind" in event))
    throw new Error("CRM_VIEWER_INPUT_INVALID");
  if (event.kind === "mouse") {
    if (
      !boundedNumber(event.x, 0, 20_000) ||
      !boundedNumber(event.y, 0, 20_000)
    )
      throw new Error("CRM_VIEWER_MOUSE_BOUNDS_INVALID");
    if (
      !["mousePressed", "mouseReleased", "mouseMoved", "mouseWheel"].includes(
        event.type
      )
    )
      throw new Error("CRM_VIEWER_MOUSE_TYPE_INVALID");
    if (
      event.type === "mouseWheel" &&
      (!boundedNumber(event.deltaX ?? 0, -10_000, 10_000) ||
        !boundedNumber(event.deltaY ?? 0, -10_000, 10_000))
    )
      throw new Error("CRM_VIEWER_WHEEL_BOUNDS_INVALID");
    return event;
  }
  if (event.kind === "key") {
    if (!["keyDown", "keyUp", "char"].includes(event.type))
      throw new Error("CRM_VIEWER_KEY_TYPE_INVALID");
    if (
      (event.key?.length || 0) > 120 ||
      (event.code?.length || 0) > 120 ||
      (event.text?.length || 0) > 4_000
    )
      throw new Error("CRM_VIEWER_KEY_BOUNDS_INVALID");
    return event;
  }
  throw new Error("CRM_VIEWER_INPUT_INVALID");
}

function controlScope(
  session: Pick<
    LiveCrmSession,
    "organisationId" | "connectedSystemId" | "userId"
  >
) {
  // Control belongs to the user's isolated browser identity. Company connector
  // definition/capabilities are shared, but one salesperson cannot seize or
  // block another salesperson's live CRM page.
  return {
    organisationId: session.organisationId,
    connectedSystemId: session.connectedSystemId,
    userId: session.userId,
  };
}

function retireViewerSession(
  session: LiveCrmSession,
  reason: "expired" | "disconnected" | "reset" = "expired"
) {
  if (!sessions.has(session.id)) return;
  session.interactive = false;
  if (session.expiresTimer) clearTimeout(session.expiresTimer);
  session.unsubscribeControl?.();
  session.unsubscribeSession?.();
  void stopStream(session);
  session.sockets.forEach(socket =>
    socket.close(
      reason === "disconnected" ? 4002 : 4001,
      reason === "disconnected"
        ? "CRM disconnected"
        : "Viewer session expired"
    )
  );
  sessions.delete(session.id);
  scopeIndex.delete(
    scopeKey(session.organisationId, session.connectedSystemId, session.userId)
  );
  releaseBrowserControl(controlScope(session));
  void recordAudit({
    userId: session.userId,
    organisationId: session.organisationId,
    eventType:
      reason === "disconnected" ? "crm_viewer_disconnected" : "crm_viewer_expired",
    entityType: "connected_system",
    entityId: String(session.connectedSystemId),
    summary:
      reason === "disconnected"
        ? "A live CRM viewer was closed because the CRM was disconnected."
        : "A live CRM viewer session expired and was closed.",
    metadata: { viewerSessionId: session.id },
  });
}

function armSessionExpiry(session: LiveCrmSession) {
  if (session.expiresTimer) clearTimeout(session.expiresTimer);
  session.expiresTimer = setTimeout(
    () => retireViewerSession(session),
    Math.max(1, session.expiresAt - Date.now())
  );
}

function touchViewerSession(session: LiveCrmSession) {
  if (!session.interactive) return;
  session.expiresAt = Date.now() + VIEWER_TTL_MS;
  armSessionExpiry(session);
}

function pruneExpiredSessions() {
  Array.from(sessions.values()).forEach(session => {
    if (session.expiresAt <= Date.now()) retireViewerSession(session);
  });
}

function setHumanLease(session: LiveCrmSession) {
  acquireHumanBrowserControl(controlScope(session), IDLE_LEASE_MS);
}

function assertHumanControl(session: LiveCrmSession) {
  if (!canAcceptBrowserInput(browserControlState(controlScope(session))))
    throw new Error("CRM_VIEWER_HUMAN_CONTROL_REQUIRED");
  touchViewerSession(session);
  setHumanLease(session);
}

export function acquireAiControl(
  sessionId: string,
  organisationId: number,
  userId: number
) {
  const session = sessions.get(sessionId);
  if (
    !session ||
    session.organisationId !== organisationId ||
    session.userId !== userId ||
    !session.interactive
  )
    throw new Error("CRM_VIEWER_SESSION_NOT_FOUND");
  touchViewerSession(session);
  return acquireAiBrowserControl(controlScope(session), IDLE_LEASE_MS);
}

export function releaseAiControl(
  sessionId: string,
  organisationId: number,
  userId: number
) {
  const session = sessions.get(sessionId);
  if (
    !session ||
    session.organisationId !== organisationId ||
    session.userId !== userId
  )
    throw new Error("CRM_VIEWER_SESSION_NOT_FOUND");
  touchViewerSession(session);
  return releaseBrowserControl(controlScope(session));
}

async function startStream(session: LiveCrmSession) {
  if (!session.interactive || session.expiresAt <= Date.now())
    throw new Error("CRM_VIEWER_SESSION_EXPIRED");
  if (session.streaming) return;
  const page = session.managed.page;
  const cdp = await page.context().newCDPSession(page);
  session.cdp = cdp;
  session.streaming = true;
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 68,
    maxWidth: 1_920,
    maxHeight: 1_200,
    everyNthFrame: 1,
  });
  cdp.on("Page.screencastFrame", frame => {
    void cdp
      .send("Page.screencastFrameAck", { sessionId: frame.sessionId })
      .catch(() => undefined);
    const bytes = Buffer.byteLength(frame.data, "base64");
    const now = Date.now();
    if (
      !shouldForwardScreencastFrame({
        visible: session.visible,
        socketCount: session.sockets.size,
        now,
        lastFrameAt: session.lastFrameAt,
        bytes,
      })
    )
      return;
    session.lastFrameAt = now;
    broadcast(session, {
      type: "frame",
      data: frame.data,
      metadata: frame.metadata || {},
      url: session.lastUrl,
    });
  });
  page.once("close", () => {
    broadcast(session, {
      type: "disconnected",
      message: "The CRM page is no longer available. Reconnect to continue.",
    });
  });
}

async function stopStream(session: LiveCrmSession) {
  if (!session.streaming) return;
  session.streaming = false;
  await session.cdp?.send("Page.stopScreencast").catch(() => undefined);
  await session.cdp?.detach().catch(() => undefined);
  session.cdp = undefined;
}

async function dispatchInput(session: LiveCrmSession, event: ViewerInputEvent) {
  if (!session.interactive || session.expiresAt <= Date.now())
    throw new Error("CRM_VIEWER_SESSION_EXPIRED");
  assertHumanControl(session);
  if (!session.cdp) throw new Error("CRM_VIEWER_STREAM_UNAVAILABLE");
  const input = assertInput(event);
  if (input.kind === "mouse") {
    await session.cdp.send("Input.dispatchMouseEvent", {
      type: input.type,
      x: input.x,
      y: input.y,
      button: input.button || "none",
      clickCount: input.clickCount || 0,
      deltaX: input.deltaX || 0,
      deltaY: input.deltaY || 0,
    });
  } else {
    if (input.type === "keyDown" && input.text) {
      await session.cdp.send("Input.insertText", { text: input.text });
      return;
    }
    await session.cdp.send("Input.dispatchKeyEvent", {
      type: input.type,
      key: input.key || "",
      code: input.code || "",
      text: input.text || "",
      modifiers: input.modifiers || 0,
    });
  }
}

export async function createLiveCrmViewerSession(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
}) {
  pruneExpiredSessions();
  const existingId = scopeIndex.get(
    scopeKey(input.organisationId, input.connectedSystemId, input.userId)
  );
  const existing = existingId ? sessions.get(existingId) : undefined;
  if (existing && existing.expiresAt > Date.now()) {
    touchViewerSession(existing);
    return viewerDescriptor(existing);
  }

  const connection = await getConnectedSystemForUser(
    input.userId,
    input.organisationId,
    input.connectedSystemId
  );
  const configuration =
    connection.configuration &&
    typeof connection.configuration === "object" &&
    !Array.isArray(connection.configuration)
      ? (connection.configuration as Record<string, unknown>)
      : {};
  if (typeof configuration.retiredAt === "string")
    throw new Error("CRM_VIEWER_DISCONNECTED");
  if (!connection.baseUrl) throw new Error("CRM_VIEWER_ADDRESS_REQUIRED");

  let managed: ManagedCrmBrowserSessionHandle;
  try {
    managed = await managedCrmBrowserSessionManager.open({
      connection: toAdapterConnection(connection),
      userId: input.userId,
    });
  } catch (error) {
    throw new Error(viewerMessage(error));
  }

  const id = randomUUID();
  const session: LiveCrmSession = {
    id,
    token: randomBytes(32),
    organisationId: input.organisationId,
    connectedSystemId: input.connectedSystemId,
    userId: input.userId,
    provider: connection.provider,
    managed,
    expiresAt: Date.now() + VIEWER_TTL_MS,
    lastUrl: managed.page.url(),
    control: "IDLE",
    visible: true,
    streaming: false,
    lastFrameAt: 0,
    sockets: new Set(),
    interactive: true,
  };
  sessions.set(id, session);
  scopeIndex.set(
    scopeKey(input.organisationId, input.connectedSystemId, input.userId),
    id
  );
  session.unsubscribeControl = subscribeBrowserControl(
    controlScope(session),
    control => {
      session.control = control;
      broadcast(session, { type: "control", control });
    }
  );
  session.unsubscribeSession = managedCrmBrowserSessionManager.subscribe(
    managed,
    snapshot => {
      session.lastUrl = snapshot.currentUrl;
      broadcast(session, { type: "session", ...snapshot });
    }
  );
  armSessionExpiry(session);
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "crm_viewer_opened",
    entityType: "connected_system",
    entityId: String(input.connectedSystemId),
    summary:
      "A private live CRM workspace viewer was opened for the signed-in salesperson.",
    metadata: {
      viewerSessionId: id,
      provider: connection.provider,
      identityScope: "user",
    },
  });
  return viewerDescriptor(session);
}

export function isLiveCrmViewerAccessAllowed(
  session: Pick<LiveCrmSession, "organisationId" | "userId" | "token">,
  input: { organisationId: number; userId: number; token: string }
) {
  return (
    session.organisationId === input.organisationId &&
    session.userId === input.userId &&
    safeEqual(session.token, Buffer.from(input.token, "base64url"))
  );
}

export async function getSanitisedLiveCrmContext(input: {
  viewerSessionId: string;
  organisationId: number;
  userId: number;
}) {
  const session = sessions.get(input.viewerSessionId);
  if (
    !session ||
    !session.interactive ||
    session.organisationId !== input.organisationId ||
    session.userId !== input.userId
  )
    throw new Error("CRM_VIEWER_SESSION_NOT_FOUND");
  touchViewerSession(session);
  const url = new URL(session.lastUrl);
  const title = (await session.managed.page.title().catch(() => ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
  return {
    connectedSystemId: session.connectedSystemId,
    provider: session.provider,
    authorisedUrlPath: `${url.origin}${url.pathname}`,
    pageTitle: title || undefined,
    control: browserControlState(controlScope(session)),
    connectionIdentityMode: "user_connection" as const,
  };
}

function viewerDescriptor(session: LiveCrmSession) {
  return {
    viewerSessionId: session.id,
    viewerToken: session.token.toString("base64url"),
    expiresAt: new Date(session.expiresAt).toISOString(),
    url: session.lastUrl,
    control: session.control,
  };
}

function expectedOrigin(request: IncomingMessage) {
  const proto = String(request.headers["x-forwarded-proto"] || "http")
    .split(",")[0]
    .trim();
  const host = String(
    request.headers["x-forwarded-host"] || request.headers.host || ""
  )
    .split(",")[0]
    .trim();
  return host ? `${proto}://${host}` : "";
}

export function registerLiveCrmViewerSocket(server: Server) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
  });
  server.on("upgrade", (request, socket, head) => {
    void (async () => {
      try {
        const url = new URL(
          request.url || "",
          expectedOrigin(request) || "http://localhost"
        );
        if (url.pathname !== "/api/crm-viewer/stream") return;
        const origin = request.headers.origin;
        if (!origin || origin !== expectedOrigin(request))
          throw new Error("CRM_VIEWER_ORIGIN_BLOCKED");
        const context = await requireLocalHttpContext(request as never);
        const sessionId = url.searchParams.get("session");
        const token = url.searchParams.get("token");
        if (!sessionId || !token) throw new Error("CRM_VIEWER_TOKEN_REQUIRED");
        pruneExpiredSessions();
        const session = sessions.get(sessionId);
        if (!session || !session.interactive || session.expiresAt <= Date.now())
          throw new Error("CRM_VIEWER_SESSION_EXPIRED");
        if (
          !isLiveCrmViewerAccessAllowed(session, {
            organisationId: context.membership.organisationId,
            userId: context.userId,
            token,
          })
        )
          throw new Error("CRM_VIEWER_SCOPE_BLOCKED");
        if (session.sockets.size >= MAX_VIEWERS_PER_SESSION)
          throw new Error("CRM_VIEWER_ALREADY_OPEN");
        touchViewerSession(session);
        wss.handleUpgrade(request, socket, head, ws => {
          wss.emit("connection", ws, request, session);
        });
      } catch {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
      }
    })();
  });

  wss.on(
    "connection",
    (socket: WebSocket, _request: IncomingMessage, session: LiveCrmSession) => {
      session.sockets.add(socket);
      touchViewerSession(session);
      void startStream(session)
        .then(() => {
          socketPayload(socket, {
            type: "ready",
            url: session.lastUrl,
            control: session.control,
            expiresAt: new Date(session.expiresAt).toISOString(),
          });
        })
        .catch(error => {
          socketPayload(socket, {
            type: "error",
            code: "CRM_BROWSER_UNAVAILABLE",
            message: viewerMessage(error),
          });
          socket.close(1011, "Stream unavailable");
        });

      socket.on("message", (raw: RawData) => {
        void (async () => {
          try {
            const message = parseMessage(raw);
            touchViewerSession(session);
            if (message.type === "input") {
              await dispatchInput(session, message.event);
            } else if (message.type === "visibility") {
              session.visible = Boolean(message.visible);
              if (!session.visible) await stopStream(session);
              else await startStream(session);
            } else if (message.type === "resize") {
              if (
                !boundedNumber(message.width, 240, 3_840) ||
                !boundedNumber(message.height, 240, 2_400)
              )
                throw new Error("CRM_VIEWER_RESIZE_INVALID");
              const width = Math.round(message.width);
              const height = Math.round(message.height);
              await session.cdp?.send("Emulation.setDeviceMetricsOverride", {
                width,
                height,
                screenWidth: width,
                screenHeight: height,
                deviceScaleFactor:
                  typeof message.deviceScaleFactor === "number" &&
                  boundedNumber(message.deviceScaleFactor, 1, 2)
                    ? message.deviceScaleFactor
                    : 1,
                mobile: false,
                scale: 1,
                positionX: 0,
                positionY: 0,
                dontSetVisibleSize: false,
              });
            } else if (message.type === "releaseHumanControl") {
              releaseBrowserControl(controlScope(session));
            } else if (message.type === "acquireHumanControl") {
              acquireHumanBrowserControl(controlScope(session), VIEWER_TTL_MS);
              await recordAudit({
                userId: session.userId,
                organisationId: session.organisationId,
                eventType: "human_control_started",
                entityType: "connected_system",
                entityId: String(session.connectedSystemId),
                summary: "The customer took control of the Secure CRM Browser.",
                metadata: { identityScope: "user" },
              });
            } else if (message.type === "navigation") {
              // Browser history/reload can submit forms or replay page state, so
              // it is a human-controlled browser action just like clicking.
              assertHumanControl(session);
              await managedCrmBrowserSessionManager.navigate(
                session.managed,
                message.action
              );
            } else if (message.type === "customerFinishedSigningIn") {
              await managedCrmBrowserSessionManager.customerFinishedSigningIn(
                session.managed
              );
            } else if (message.type === "ping") {
              socketPayload(socket, {
                type: "pong",
                expiresAt: new Date(session.expiresAt).toISOString(),
              });
            }
          } catch (error) {
            socketPayload(socket, {
              type: "error",
              code: "CRM_BROWSER_ACTION_FAILED",
              message: viewerMessage(error),
            });
          }
        })();
      });

      socket.on("close", () => {
        session.sockets.delete(socket);
        if (!session.sockets.size) void stopStream(session);
      });
    }
  );
}

/** Close every user's live viewer for one company CRM before disconnecting it. */
export function closeLiveCrmViewerSessionsForConnection(input: {
  organisationId: number;
  connectedSystemId: number;
}) {
  const targets = Array.from(sessions.values()).filter(
    session =>
      session.organisationId === input.organisationId &&
      session.connectedSystemId === input.connectedSystemId
  );
  targets.forEach(session => retireViewerSession(session, "disconnected"));
  return targets.length;
}

export function resetLiveCrmViewerForTests() {
  Array.from(sessions.values()).forEach(session =>
    retireViewerSession(session, "reset")
  );
  sessions.clear();
  scopeIndex.clear();
}

export const LIVE_CRM_VIEWER_LIMITS = {
  viewerTtlMs: VIEWER_TTL_MS,
  idleLeaseMs: IDLE_LEASE_MS,
  maxMessageBytes: MAX_MESSAGE_BYTES,
  maxFrameBytes: MAX_FRAME_BYTES,
  maxFrameRate: MAX_FRAME_RATE,
};
