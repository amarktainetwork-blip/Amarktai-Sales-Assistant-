import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import { URL } from "node:url";
import type { CDPSession, Page } from "playwright-core";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { getConnectedSystemForUser, toAdapterConnection } from "./connectedSystems";
import { openBrowserCrmLivePage } from "./browserConnectors/browserCrmAdapter";
import { assertAuthorisedConnectionUrl } from "./connectedSystems";
import { recordAudit } from "./db";
import { requireLocalHttpContext } from "./httpAuth";

const VIEWER_TTL_MS = 5 * 60_000;
const IDLE_LEASE_MS = 8_000;
const MAX_MESSAGE_BYTES = 16 * 1024;
const MAX_FRAME_BYTES = 1_600_000;
const MAX_FRAME_RATE = 10;
const MAX_VIEWERS_PER_SESSION = 1;

type ControlState = "AI_CONTROL" | "HUMAN_CONTROL" | "READ_ONLY_OBSERVE" | "IDLE";
type ViewerSocketMessage =
  | { type: "input"; event: ViewerInputEvent }
  | { type: "resize"; width: number; height: number; deviceScaleFactor?: number }
  | { type: "visibility"; visible: boolean }
  | { type: "releaseHumanControl" }
  | { type: "ping" };

type ViewerInputEvent =
  | { kind: "mouse"; type: "mousePressed" | "mouseReleased" | "mouseMoved" | "mouseWheel"; x: number; y: number; button?: "none" | "left" | "middle" | "right"; clickCount?: number; deltaX?: number; deltaY?: number }
  | { kind: "key"; type: "keyDown" | "keyUp" | "char"; key?: string; code?: string; text?: string; modifiers?: number };

type LiveCrmSession = {
  id: string;
  token: Buffer;
  organisationId: number;
  connectedSystemId: number;
  userId: number;
  provider: "genie" | "custom_browser";
  page: Page;
  release: () => Promise<void>;
  cdp?: CDPSession;
  expiresAt: number;
  lastUrl: string;
  control: ControlState;
  leaseOwner?: "human" | "ai";
  leaseExpiresAt?: number;
  visible: boolean;
  streaming: boolean;
  lastFrameAt: number;
  sockets: Set<WebSocket>;
};

const sessions = new Map<string, LiveCrmSession>();
const scopeIndex = new Map<string, string>();

function scopeKey(organisationId: number, connectedSystemId: number, userId: number) {
  return `${organisationId}:${connectedSystemId}:${userId}`;
}

function safeEqual(left: Buffer, right: Buffer) {
  return left.length === right.length && timingSafeEqual(left, right);
}

function socketPayload(socket: WebSocket, payload: unknown) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
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
  return typeof value === "number" && Number.isFinite(value) && value >= low && value <= high;
}

function assertInput(event: ViewerInputEvent) {
  if (!event || typeof event !== "object" || !("kind" in event))
    throw new Error("CRM_VIEWER_INPUT_INVALID");
  if (event.kind === "mouse") {
    if (!boundedNumber(event.x, 0, 20_000) || !boundedNumber(event.y, 0, 20_000))
      throw new Error("CRM_VIEWER_MOUSE_BOUNDS_INVALID");
    if (!["mousePressed", "mouseReleased", "mouseMoved", "mouseWheel"].includes(event.type))
      throw new Error("CRM_VIEWER_MOUSE_TYPE_INVALID");
    return event;
  }
  if (event.kind === "key") {
    if (!["keyDown", "keyUp", "char"].includes(event.type))
      throw new Error("CRM_VIEWER_KEY_TYPE_INVALID");
    if ((event.key?.length || 0) > 120 || (event.code?.length || 0) > 120 || (event.text?.length || 0) > 4_000)
      throw new Error("CRM_VIEWER_KEY_BOUNDS_INVALID");
    return event;
  }
  throw new Error("CRM_VIEWER_INPUT_INVALID");
}

function pruneExpiredSessions() {
  const now = Date.now();
  Array.from(sessions.entries()).forEach(([id, session]) => {
    if (session.expiresAt > now) return;
    stopStream(session).catch(() => undefined);
    session.sockets.forEach((socket: WebSocket) => socket.close(4001, "Viewer session expired"));
    sessions.delete(id);
    scopeIndex.delete(scopeKey(session.organisationId, session.connectedSystemId, session.userId));
    session.release().catch(() => undefined);
  });
}

function setHumanLease(session: LiveCrmSession) {
  session.control = "HUMAN_CONTROL";
  session.leaseOwner = "human";
  session.leaseExpiresAt = Date.now() + IDLE_LEASE_MS;
  broadcast(session, { type: "control", control: session.control, message: "You are controlling this CRM." });
}

function releaseExpiredLease(session: LiveCrmSession) {
  if (session.leaseExpiresAt && session.leaseExpiresAt < Date.now()) {
    session.control = "READ_ONLY_OBSERVE";
    session.leaseOwner = undefined;
    session.leaseExpiresAt = undefined;
    broadcast(session, { type: "control", control: session.control });
  }
}

export function acquireAiControl(sessionId: string, organisationId: number, userId: number) {
  const session = sessions.get(sessionId);
  if (!session || session.organisationId !== organisationId || session.userId !== userId)
    throw new Error("CRM_VIEWER_SESSION_NOT_FOUND");
  releaseExpiredLease(session);
  if (session.control === "HUMAN_CONTROL")
    throw new Error("CRM_VIEWER_HUMAN_CONTROL_ACTIVE");
  session.control = "AI_CONTROL";
  session.leaseOwner = "ai";
  session.leaseExpiresAt = Date.now() + IDLE_LEASE_MS;
  broadcast(session, { type: "control", control: session.control, message: "Amarktai is updating this record." });
  return { control: session.control, expiresAt: new Date(session.leaseExpiresAt).toISOString() };
}

export function releaseAiControl(sessionId: string, organisationId: number, userId: number) {
  const session = sessions.get(sessionId);
  if (!session || session.organisationId !== organisationId || session.userId !== userId)
    throw new Error("CRM_VIEWER_SESSION_NOT_FOUND");
  session.control = "IDLE";
  session.leaseOwner = undefined;
  session.leaseExpiresAt = undefined;
  broadcast(session, { type: "control", control: session.control });
  return { control: session.control };
}

async function startStream(session: LiveCrmSession) {
  if (session.streaming) return;
  const cdp = await session.page.context().newCDPSession(session.page);
  session.cdp = cdp;
  session.streaming = true;
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 72,
    maxWidth: 1_920,
    maxHeight: 1_200,
    everyNthFrame: 1,
  });
  cdp.on("Page.screencastFrame", frame => {
    void cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => undefined);
    if (!session.visible || !session.sockets.size || Date.now() - session.lastFrameAt < 1_000 / MAX_FRAME_RATE) return;
    const bytes = Buffer.byteLength(frame.data, "base64");
    if (bytes > MAX_FRAME_BYTES) return;
    session.lastFrameAt = Date.now();
    broadcast(session, { type: "frame", data: frame.data, metadata: frame.metadata || {}, url: session.lastUrl });
  });
  session.page.on("framenavigated", frame => {
    if (frame !== session.page.mainFrame()) return;
    const url = frame.url();
    void assertAuthorisedConnectionUrl({
      organisationId: session.organisationId,
      connectedSystemId: session.connectedSystemId,
      rawUrl: url,
    })
      .then(() => {
        session.lastUrl = url;
        broadcast(session, { type: "navigation", url });
      })
      .catch(() => {
        broadcast(session, { type: "error", code: "CRM_VIEWER_PATH_BLOCKED" });
      });
  });
  session.page.once("close", () => {
    broadcast(session, { type: "disconnected", message: "The CRM page is no longer available. Reconnect to continue." });
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
  setHumanLease(session);
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
  const existingId = scopeIndex.get(scopeKey(input.organisationId, input.connectedSystemId, input.userId));
  const existing = existingId ? sessions.get(existingId) : undefined;
  if (existing && existing.expiresAt > Date.now()) {
    existing.expiresAt = Date.now() + VIEWER_TTL_MS;
    return viewerDescriptor(existing);
  }
  const connection = await getConnectedSystemForUser(input.userId, input.organisationId, input.connectedSystemId);
  if (connection.connectionMethod !== "browser" && connection.connectionMethod !== "sidecar")
    throw new Error("CRM_VIEWER_BROWSER_CONNECTION_REQUIRED");
  if (connection.provider !== "genie" && connection.provider !== "custom_browser")
    throw new Error("CRM_VIEWER_PROVIDER_NOT_SUPPORTED");
  if (!["ready", "limited_permissions"].includes(connection.status))
    throw new Error("CRM_VIEWER_CONNECTION_NOT_READY");
  const opened = await openBrowserCrmLivePage({
    connection: toAdapterConnection(connection),
    provider: connection.provider,
  });
  const id = randomUUID();
  const session: LiveCrmSession = {
    id,
    token: randomBytes(32),
    organisationId: input.organisationId,
    connectedSystemId: input.connectedSystemId,
    userId: input.userId,
    provider: connection.provider,
    page: opened.page,
    release: opened.release,
    expiresAt: Date.now() + VIEWER_TTL_MS,
    lastUrl: opened.page.url(),
    control: "READ_ONLY_OBSERVE",
    visible: true,
    streaming: false,
    lastFrameAt: 0,
    sockets: new Set(),
  };
  sessions.set(id, session);
  scopeIndex.set(scopeKey(input.organisationId, input.connectedSystemId, input.userId), id);
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "crm_viewer_opened",
    entityType: "connected_system",
    entityId: String(input.connectedSystemId),
    summary: "A live CRM workspace viewer was opened for the signed-in salesperson.",
    metadata: { viewerSessionId: id, provider: connection.provider },
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
  const proto = String(request.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  const host = String(request.headers["x-forwarded-host"] || request.headers.host || "").split(",")[0].trim();
  return host ? `${proto}://${host}` : "";
}

export function registerLiveCrmViewerSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  server.on("upgrade", (request, socket, head) => {
    void (async () => {
      try {
        const url = new URL(request.url || "", expectedOrigin(request) || "http://localhost");
        if (url.pathname !== "/api/crm-viewer/stream") return;
        const origin = request.headers.origin;
        if (!origin || origin !== expectedOrigin(request)) throw new Error("CRM_VIEWER_ORIGIN_BLOCKED");
        const context = await requireLocalHttpContext(request as never);
        const sessionId = url.searchParams.get("session");
        const token = url.searchParams.get("token");
        if (!sessionId || !token) throw new Error("CRM_VIEWER_TOKEN_REQUIRED");
        pruneExpiredSessions();
        const session = sessions.get(sessionId);
        if (!session || session.expiresAt <= Date.now()) throw new Error("CRM_VIEWER_SESSION_EXPIRED");
        if (!isLiveCrmViewerAccessAllowed(session, {
          organisationId: context.membership.organisationId,
          userId: context.userId,
          token,
        })) throw new Error("CRM_VIEWER_SCOPE_BLOCKED");
        if (session.sockets.size >= MAX_VIEWERS_PER_SESSION) throw new Error("CRM_VIEWER_ALREADY_OPEN");
        wss.handleUpgrade(request, socket, head, ws => {
          wss.emit("connection", ws, request, session);
        });
      } catch {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
      }
    })();
  });
  wss.on("connection", (socket: WebSocket, _request: IncomingMessage, session: LiveCrmSession) => {
    session.sockets.add(socket);
    void startStream(session)
      .then(() => {
        socketPayload(socket, { type: "ready", url: session.lastUrl, control: session.control, expiresAt: new Date(session.expiresAt).toISOString() });
      })
      .catch(error => {
        socketPayload(socket, { type: "error", code: "CRM_VIEWER_STREAM_FAILED", message: error instanceof Error ? error.message.slice(0, 200) : "The CRM stream could not start." });
        socket.close(1011, "Stream unavailable");
      });
    socket.on("message", (raw: RawData) => {
      void (async () => {
        try {
          const message = parseMessage(raw);
          if (message.type === "input") await dispatchInput(session, message.event);
          else if (message.type === "visibility") {
            session.visible = Boolean(message.visible);
            if (!session.visible) await stopStream(session);
            else await startStream(session);
          } else if (message.type === "resize") {
            if (!boundedNumber(message.width, 240, 3_840) || !boundedNumber(message.height, 240, 2_400))
              throw new Error("CRM_VIEWER_RESIZE_INVALID");
            await session.cdp?.send("Emulation.setDeviceMetricsOverride", {
              width: Math.round(message.width),
              height: Math.round(message.height),
              deviceScaleFactor:
                typeof message.deviceScaleFactor === "number" &&
                boundedNumber(message.deviceScaleFactor, 1, 2)
                  ? message.deviceScaleFactor
                  : 1,
              mobile: false,
            });
          } else if (message.type === "releaseHumanControl") {
            session.control = "IDLE";
            session.leaseOwner = undefined;
            session.leaseExpiresAt = undefined;
            broadcast(session, { type: "control", control: session.control });
          } else if (message.type === "ping") socketPayload(socket, { type: "pong" });
        } catch (error) {
          socketPayload(socket, { type: "error", code: error instanceof Error ? error.message : "CRM_VIEWER_MESSAGE_FAILED" });
        }
      })();
    });
    socket.on("close", () => {
      session.sockets.delete(socket);
      if (!session.sockets.size) void stopStream(session);
    });
  });
}

export function resetLiveCrmViewerForTests() {
  sessions.clear();
  scopeIndex.clear();
}

export const LIVE_CRM_VIEWER_LIMITS = {
  viewerTtlMs: VIEWER_TTL_MS,
  maxMessageBytes: MAX_MESSAGE_BYTES,
  maxFrameBytes: MAX_FRAME_BYTES,
  maxFrameRate: MAX_FRAME_RATE,
};
