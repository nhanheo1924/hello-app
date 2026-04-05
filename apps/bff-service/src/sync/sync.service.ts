import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { IncomingHttpHeaders, IncomingMessage } from "http";
import type { Request, Response } from "express";
import { createHash, randomUUID } from "crypto";
import type WebSocket from "ws";

type RealtimeStatus = "connected" | "reconnecting" | "offline";

type SyncConnection = {
  id: string;
  userKey: string;
  workspaceId: string;
  response: Response;
};

type SyncSocketConnection = {
  id: string;
  userKey: string;
  workspaceId: string;
  socket: WebSocket;
};

type InvalidateEvent = {
  userKey: string;
  workspaceId: string;
  resource: string;
  ts: number;
};

type TargetedSyncEvent = {
  userKeys: string[];
  workspaceId: string;
  eventName: string;
  payload: Record<string, unknown>;
};

const HEARTBEAT_INTERVAL_MS = 20_000;
const COALESCE_WINDOW_MS = 1_000;
const WILDCARD_WORKSPACE = "*";
const DEFAULT_SCOPE = "default";
const ADMIN_SCOPE = "admin";
const ADMIN_USER_KEY = "admin:*";
const ADMIN_SYSTEM_ROLES = new Set(["SYSTEM_ADMIN", "SUPER_ADMIN"]);
const AUTH_ACCESS_COOKIE_NAME = "ctm_at";
const WORKSPACE_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseJsonRecord(raw: string): Record<string, unknown> | null {
  const parsed: unknown = JSON.parse(raw);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

@Injectable()
export class SyncService implements OnModuleInit, OnModuleDestroy {
  private readonly connections = new Map<string, SyncConnection>();
  private readonly socketConnections = new Map<string, SyncSocketConnection>();
  private readonly pendingEvents = new Map<string, InvalidateEvent>();
  private readonly coalesceTimers = new Map<string, NodeJS.Timeout>();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  onModuleInit(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    this.heartbeatTimer = setInterval(() => {
      this.broadcastPing();
    }, HEARTBEAT_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    this.coalesceTimers.forEach((timer) => clearTimeout(timer));
    this.coalesceTimers.clear();
    this.pendingEvents.clear();

    this.connections.forEach((connection) => {
      try {
        connection.response.end();
      } catch {
        // no-op
      }
    });
    this.connections.clear();

    this.socketConnections.forEach((connection) => {
      try {
        connection.socket.close(1001, "Server shutting down");
      } catch {
        // no-op
      }
    });
    this.socketConnections.clear();
  }

  openStream(
    request: Request,
    response: Response,
    query: {
      workspaceId?: string;
      token?: string;
      scope?: string;
    },
  ): void {
    const scope = this.normalizeScope(query.scope);
    const userKey = this.extractUserKey(request, query.token, scope);
    if (!userKey) {
      response.status(scope === ADMIN_SCOPE ? 403 : 401).json(
        scope === ADMIN_SCOPE
          ? {
              code: "FORBIDDEN",
              message: "Admin permission required",
            }
          : {
              code: "UNAUTHORIZED",
              message: "Missing authentication token",
            },
      );
      return;
    }

    const workspaceId = this.normalizeWorkspaceId(query.workspaceId);
    const connectionId = randomUUID();

    response.status(200);
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders?.();

    this.writeEvent(response, "sync.status", {
      status: "connected" as RealtimeStatus,
      workspaceId,
      ts: Date.now(),
    });

    this.connections.set(connectionId, {
      id: connectionId,
      userKey,
      workspaceId,
      response,
    });

    request.on("close", () => {
      this.connections.delete(connectionId);
    });
  }

  openWebSocket(
    request: IncomingMessage,
    socket: WebSocket,
    query: {
      workspaceId?: string;
      token?: string;
      scope?: string;
    },
  ): void {
    const scope = this.normalizeScope(query.scope);
    const userKey = this.extractUserKeyFromSocket(request, query.token, scope);
    if (!userKey) {
      const code = scope === ADMIN_SCOPE ? "FORBIDDEN" : "UNAUTHORIZED";
      const message =
        scope === ADMIN_SCOPE
          ? "Admin permission required"
          : "Missing authentication token";
      this.writeSocketEvent(socket, "sync.error", {
        code,
        message,
        ts: Date.now(),
      });
      socket.close(4403, message);
      return;
    }

    const workspaceId = this.normalizeWorkspaceId(query.workspaceId);
    const connectionId = randomUUID();

    this.socketConnections.set(connectionId, {
      id: connectionId,
      userKey,
      workspaceId,
      socket,
    });

    this.writeSocketEvent(socket, "sync.status", {
      status: "connected" as RealtimeStatus,
      workspaceId,
      ts: Date.now(),
    });

    socket.on("close", () => {
      this.socketConnections.delete(connectionId);
    });
    socket.on("error", () => {
      this.socketConnections.delete(connectionId);
    });
  }

  publishInvalidateFromRequest(
    request: Request,
    input: {
      workspaceId?: string;
      resource?: string;
    },
  ): void {
    const userKey = this.extractUserKey(request);
    if (!userKey) return;

    this.publishInvalidate({
      userKey,
      workspaceId: input.workspaceId,
      resource: input.resource,
    });
  }

  publishInvalidate(input: {
    userKey: string;
    workspaceId?: string;
    resource?: string;
  }): void {
    const userKey = String(input.userKey || "").trim();
    if (!userKey) return;

    const workspaceId = this.normalizeWorkspaceId(input.workspaceId);
    const resource = String(input.resource || "tasks").trim() || "tasks";
    const coalesceKey = `${userKey}|${workspaceId}`;

    this.pendingEvents.set(coalesceKey, {
      userKey,
      workspaceId,
      resource,
      ts: Date.now(),
    });

    if (this.coalesceTimers.has(coalesceKey)) {
      return;
    }

    const timer = setTimeout(() => {
      this.coalesceTimers.delete(coalesceKey);
      const event = this.pendingEvents.get(coalesceKey);
      this.pendingEvents.delete(coalesceKey);
      if (!event) return;
      this.broadcastInvalidate(event);
    }, COALESCE_WINDOW_MS);

    this.coalesceTimers.set(coalesceKey, timer);
  }

  publishInvalidateMany(input: {
    userKeys: string[];
    workspaceId?: string;
    resource?: string;
  }): void {
    const uniqueUserKeys = Array.from(
      new Set((input.userKeys || []).map((value) => String(value || "").trim())),
    ).filter((value) => value.length > 0);
    uniqueUserKeys.forEach((userKey) => {
      this.publishInvalidate({
        userKey,
        workspaceId: input.workspaceId,
        resource: input.resource,
      });
    });
  }

  publishEventToUsers(input: {
    userKeys: string[];
    workspaceId?: string;
    eventName: string;
    payload: Record<string, unknown>;
  }): void {
    const workspaceId = this.normalizeWorkspaceId(input.workspaceId);
    const uniqueUserKeys = Array.from(
      new Set((input.userKeys || []).map((value) => String(value || "").trim())),
    ).filter((value) => value.length > 0);
    if (uniqueUserKeys.length === 0) {
      return;
    }

    this.broadcastTargetedEvent({
      userKeys: uniqueUserKeys,
      workspaceId,
      eventName: String(input.eventName || "").trim(),
      payload: input.payload || {},
    });
  }

  publishAdminEvent(payload: Record<string, unknown>): void {
    this.publishEventToUsers({
      userKeys: [ADMIN_USER_KEY],
      workspaceId: WILDCARD_WORKSPACE,
      eventName: "admin.event",
      payload,
    });
  }

  publishAdminDelta(payload: Record<string, unknown>): void {
    this.publishEventToUsers({
      userKeys: [ADMIN_USER_KEY],
      workspaceId: WILDCARD_WORKSPACE,
      eventName: "admin.delta",
      payload,
    });
  }

  publishWorkspaceTaskDelta(input: {
    userKeys: string[];
    workspaceId?: string;
    projectId?: string;
    taskId: string;
    operation: "create" | "update" | "move" | "delete";
    taskPatch?: Record<string, unknown> | null;
    occurredAt?: number;
  }): void {
    const taskId = String(input.taskId || "").trim();
    if (!taskId) {
      return;
    }

    const occurredAt =
      typeof input.occurredAt === "number" && Number.isFinite(input.occurredAt)
        ? input.occurredAt
        : Date.now();

    this.publishEventToUsers({
      userKeys: input.userKeys,
      workspaceId: input.workspaceId,
      eventName: "workspace.task.delta",
      payload: {
        eventId: randomUUID(),
        workspaceId: this.normalizeWorkspaceId(input.workspaceId),
        projectId:
          typeof input.projectId === "string" && input.projectId.trim()
            ? input.projectId.trim()
            : null,
        taskId,
        operation: input.operation,
        taskPatch: input.taskPatch ?? null,
        occurredAt,
      },
    });
  }

  buildUserKeyFromUserId(userId: string): string {
    const normalized = String(userId || "").trim();
    return normalized ? `u:${normalized}` : "";
  }

  private broadcastInvalidate(event: InvalidateEvent): void {
    this.connections.forEach((connection) => {
      if (connection.userKey !== event.userKey) return;

      const shouldReceive = this.shouldReceiveWorkspaceEvent(
        connection.workspaceId,
        event.workspaceId,
      );
      if (!shouldReceive) return;

      this.writeEvent(connection.response, "sync.invalidate", {
        workspaceId: event.workspaceId,
        resource: event.resource,
        ts: event.ts,
      });
    });

    this.socketConnections.forEach((connection) => {
      if (connection.userKey !== event.userKey) return;

      const shouldReceive = this.shouldReceiveWorkspaceEvent(
        connection.workspaceId,
        event.workspaceId,
      );
      if (!shouldReceive) return;

      this.writeSocketEvent(connection.socket, "sync.invalidate", {
        workspaceId: event.workspaceId,
        resource: event.resource,
        ts: event.ts,
      });
    });
  }

  private broadcastTargetedEvent(event: TargetedSyncEvent): void {
    if (!event.eventName) {
      return;
    }

    const userKeySet = new Set(event.userKeys);
    this.connections.forEach((connection) => {
      if (!userKeySet.has(connection.userKey)) return;
      const shouldReceive = this.shouldReceiveWorkspaceEvent(
        connection.workspaceId,
        event.workspaceId,
      );
      if (!shouldReceive) return;
      this.writeEvent(connection.response, event.eventName, event.payload);
    });

    this.socketConnections.forEach((connection) => {
      if (!userKeySet.has(connection.userKey)) return;
      const shouldReceive = this.shouldReceiveWorkspaceEvent(
        connection.workspaceId,
        event.workspaceId,
      );
      if (!shouldReceive) return;
      this.writeSocketEvent(connection.socket, event.eventName, event.payload);
    });
  }

  private broadcastPing(): void {
    const now = Date.now();
    this.connections.forEach((connection) => {
      this.writeEvent(connection.response, "ping", { ts: now });
    });

    this.socketConnections.forEach((connection) => {
      this.writeSocketEvent(connection.socket, "ping", { ts: now });
    });
  }

  private writeEvent(
    response: Response,
    eventName: string,
    payload: Record<string, unknown>,
  ): void {
    try {
      response.write(`event: ${eventName}\n`);
      response.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch {
      // silently ignore broken sockets; express close handler removes them
    }
  }

  private writeSocketEvent(
    socket: WebSocket,
    eventName: string,
    payload: Record<string, unknown>,
  ): void {
    if (socket.readyState !== 1) {
      return;
    }
    try {
      socket.send(
        JSON.stringify({
          event: eventName,
          data: payload,
        }),
      );
    } catch {
      // silently ignore broken sockets; close handler removes them
    }
  }

  private shouldReceiveWorkspaceEvent(
    connectionWorkspaceId: string,
    eventWorkspaceId: string,
  ): boolean {
    return (
      eventWorkspaceId === WILDCARD_WORKSPACE ||
      connectionWorkspaceId === WILDCARD_WORKSPACE ||
      connectionWorkspaceId === eventWorkspaceId
    );
  }

  private normalizeWorkspaceId(raw: string | undefined): string {
    const candidate = String(raw || "").trim();
    if (!candidate) return WILDCARD_WORKSPACE;
    if (!WORKSPACE_ID_REGEX.test(candidate)) return WILDCARD_WORKSPACE;
    return candidate;
  }

  private extractUserKey(
    request: Request,
    tokenOverride?: string,
    scope: "default" | "admin" = DEFAULT_SCOPE,
  ): string {
    const token = this.extractAccessToken(request, tokenOverride);
    return this.extractUserKeyFromToken(token, scope);
  }

  private extractUserKeyFromSocket(
    request: IncomingMessage,
    tokenOverride?: string,
    scope: "default" | "admin" = DEFAULT_SCOPE,
  ): string {
    const token = this.extractAccessTokenFromHeaders(
      request.headers,
      tokenOverride,
    );
    return this.extractUserKeyFromToken(token, scope);
  }

  private extractUserKeyFromToken(
    token: string,
    scope: "default" | "admin" = DEFAULT_SCOPE,
  ): string {
    if (!token) return "";

    const payload = this.parseJwtPayload(token);
    if (scope === ADMIN_SCOPE) {
      const systemRole = this.extractSystemRole(payload);
      if (!ADMIN_SYSTEM_ROLES.has(systemRole)) {
        return "";
      }
      return ADMIN_USER_KEY;
    }

    const subject =
      (typeof payload.sub === "string" && payload.sub.trim()) ||
      (typeof payload.id === "string" && payload.id.trim()) ||
      (typeof payload.userId === "string" && payload.userId.trim()) ||
      (typeof payload.email === "string" && payload.email.trim()) ||
      "";

    if (subject) {
      return `u:${subject}`;
    }

    const digest = createHash("sha256")
      .update(token)
      .digest("hex")
      .slice(0, 24);
    return `t:${digest}`;
  }

  private normalizeScope(raw: string | undefined): "default" | "admin" {
    return String(raw || "")
      .trim()
      .toLowerCase() === ADMIN_SCOPE
      ? ADMIN_SCOPE
      : DEFAULT_SCOPE;
  }

  private extractAccessToken(request: Request, tokenOverride?: string): string {
    const tokenFromQuery = request.query?.token;
    const queryToken =
      typeof tokenFromQuery === "string" ? tokenFromQuery : undefined;
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const tokenFromCookie =
      cookies && typeof cookies[AUTH_ACCESS_COOKIE_NAME] === "string"
        ? String(cookies[AUTH_ACCESS_COOKIE_NAME]).trim()
        : "";
    return this.extractAccessTokenFromHeaders(
      request.headers,
      tokenOverride,
      queryToken,
      tokenFromCookie,
    );
  }

  private extractAccessTokenFromHeaders(
    headers: IncomingHttpHeaders,
    tokenOverride?: string,
    queryToken?: string,
    cookieTokenHint?: string,
  ): string {
    const override = String(tokenOverride || "").trim();
    if (override) return override;

    const authHeader = String(headers.authorization || "").trim();
    if (authHeader.toLowerCase().startsWith("bearer ")) {
      return authHeader.slice(7).trim();
    }

    const tokenFromCookieHint = String(cookieTokenHint || "").trim();
    if (tokenFromCookieHint) {
      return tokenFromCookieHint;
    }

    const cookieHeader = String(headers.cookie || "").trim();
    if (cookieHeader) {
      const tokenFromCookie = this.extractCookieValue(
        cookieHeader,
        AUTH_ACCESS_COOKIE_NAME,
      );
      if (tokenFromCookie) {
        return tokenFromCookie;
      }
    }

    if (typeof queryToken === "string" && queryToken.trim()) {
      return queryToken.trim();
    }

    return "";
  }

  private extractCookieValue(cookieHeader: string, key: string): string {
    const target = `${key}=`;
    const segments = String(cookieHeader || "")
      .split(";")
      .map((part) => part.trim());
    const entry = segments.find((part) => part.startsWith(target));
    if (!entry) {
      return "";
    }
    try {
      return decodeURIComponent(entry.slice(target.length)).trim();
    } catch {
      return entry.slice(target.length).trim();
    }
  }

  private extractSystemRole(payload: Record<string, unknown>): string {
    const role =
      (typeof payload.systemRole === "string" && payload.systemRole.trim()) ||
      (typeof payload.role === "string" && payload.role.trim()) ||
      "";
    return role.toUpperCase();
  }

  private parseJwtPayload(token: string): Record<string, unknown> {
    try {
      const parts = token.split(".");
      if (parts.length < 2) return {};

      const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
      const decoded = Buffer.from(padded, "base64").toString("utf8");
      return parseJsonRecord(decoded) ?? {};
    } catch {
      return {};
    }
  }
}
