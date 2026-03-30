import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { IncomingHttpHeaders, IncomingMessage } from 'http';
import type { Request, Response } from 'express';
import { createHash, randomUUID } from 'crypto';
import type WebSocket from 'ws';

type RealtimeStatus = 'connected' | 'reconnecting' | 'offline';

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

const HEARTBEAT_INTERVAL_MS = 20_000;
const COALESCE_WINDOW_MS = 1_000;
const WILDCARD_WORKSPACE = '*';
const DEFAULT_SCOPE = 'default';
const ADMIN_SCOPE = 'admin';
const ADMIN_USER_KEY = 'admin:*';
const ADMIN_SYSTEM_ROLES = new Set(['SYSTEM_ADMIN', 'SUPER_ADMIN']);
const WORKSPACE_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
        connection.socket.close(1001, 'Server shutting down');
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
    },
  ): void {
    const userKey = this.extractUserKey(request, query.token);
    if (!userKey) {
      response.status(401).json({
        code: 'UNAUTHORIZED',
        message: 'Missing authentication token',
      });
      return;
    }

    const workspaceId = this.normalizeWorkspaceId(query.workspaceId);
    const connectionId = randomUUID();

    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders?.();

    this.writeEvent(response, 'sync.status', {
      status: 'connected' as RealtimeStatus,
      workspaceId,
      ts: Date.now(),
    });

    this.connections.set(connectionId, {
      id: connectionId,
      userKey,
      workspaceId,
      response,
    });

    request.on('close', () => {
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
      const code = scope === ADMIN_SCOPE ? 'FORBIDDEN' : 'UNAUTHORIZED';
      const message =
        scope === ADMIN_SCOPE
          ? 'Admin permission required'
          : 'Missing authentication token';
      this.writeSocketEvent(socket, 'sync.error', { code, message, ts: Date.now() });
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

    this.writeSocketEvent(socket, 'sync.status', {
      status: 'connected' as RealtimeStatus,
      workspaceId,
      ts: Date.now(),
    });

    socket.on('close', () => {
      this.socketConnections.delete(connectionId);
    });
    socket.on('error', () => {
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
    const userKey = String(input.userKey || '').trim();
    if (!userKey) return;

    const workspaceId = this.normalizeWorkspaceId(input.workspaceId);
    const resource = String(input.resource || 'tasks').trim() || 'tasks';
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

  private broadcastInvalidate(event: InvalidateEvent): void {
    this.connections.forEach((connection) => {
      if (connection.userKey !== event.userKey) return;

      const shouldReceive = this.shouldReceiveWorkspaceEvent(
        connection.workspaceId,
        event.workspaceId,
      );
      if (!shouldReceive) return;

      this.writeEvent(connection.response, 'sync.invalidate', {
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

      this.writeSocketEvent(connection.socket, 'sync.invalidate', {
        workspaceId: event.workspaceId,
        resource: event.resource,
        ts: event.ts,
      });
    });
  }

  private broadcastPing(): void {
    const now = Date.now();
    this.connections.forEach((connection) => {
      this.writeEvent(connection.response, 'ping', { ts: now });
    });

    this.socketConnections.forEach((connection) => {
      this.writeSocketEvent(connection.socket, 'ping', { ts: now });
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
    const candidate = String(raw || '').trim();
    if (!candidate) return WILDCARD_WORKSPACE;
    if (!WORKSPACE_ID_REGEX.test(candidate)) return WILDCARD_WORKSPACE;
    return candidate;
  }

  private extractUserKey(
    request: Request,
    tokenOverride?: string,
    scope: 'default' | 'admin' = DEFAULT_SCOPE,
  ): string {
    const token = this.extractAccessToken(request, tokenOverride);
    return this.extractUserKeyFromToken(token, scope);
  }

  private extractUserKeyFromSocket(
    request: IncomingMessage,
    tokenOverride?: string,
    scope: 'default' | 'admin' = DEFAULT_SCOPE,
  ): string {
    const token = this.extractAccessTokenFromHeaders(request.headers, tokenOverride);
    return this.extractUserKeyFromToken(token, scope);
  }

  private extractUserKeyFromToken(
    token: string,
    scope: 'default' | 'admin' = DEFAULT_SCOPE,
  ): string {
    if (!token) return '';

    const payload = this.parseJwtPayload(token);
    if (scope === ADMIN_SCOPE) {
      const systemRole = this.extractSystemRole(payload);
      if (!ADMIN_SYSTEM_ROLES.has(systemRole)) {
        return '';
      }
      return ADMIN_USER_KEY;
    }

    const subject =
      (typeof payload.sub === 'string' && payload.sub.trim()) ||
      (typeof payload.id === 'string' && payload.id.trim()) ||
      (typeof payload.userId === 'string' && payload.userId.trim()) ||
      (typeof payload.email === 'string' && payload.email.trim()) ||
      '';

    if (subject) {
      return `u:${subject}`;
    }

    const digest = createHash('sha256').update(token).digest('hex').slice(0, 24);
    return `t:${digest}`;
  }

  private normalizeScope(raw: string | undefined): 'default' | 'admin' {
    return String(raw || '').trim().toLowerCase() === ADMIN_SCOPE
      ? ADMIN_SCOPE
      : DEFAULT_SCOPE;
  }

  private extractAccessToken(request: Request, tokenOverride?: string): string {
    const tokenFromQuery = request.query?.token;
    const queryToken =
      typeof tokenFromQuery === 'string' ? tokenFromQuery : undefined;
    return this.extractAccessTokenFromHeaders(
      request.headers,
      tokenOverride,
      queryToken,
    );
  }

  private extractAccessTokenFromHeaders(
    headers: IncomingHttpHeaders,
    tokenOverride?: string,
    queryToken?: string,
  ): string {
    const override = String(tokenOverride || '').trim();
    if (override) return override;

    const authHeader = String(headers.authorization || '').trim();
    if (authHeader.toLowerCase().startsWith('bearer ')) {
      return authHeader.slice(7).trim();
    }

    if (typeof queryToken === 'string' && queryToken.trim()) {
      return queryToken.trim();
    }

    return '';
  }

  private extractSystemRole(payload: Record<string, unknown>): string {
    const role =
      (typeof payload.systemRole === 'string' && payload.systemRole.trim()) ||
      (typeof payload.role === 'string' && payload.role.trim()) ||
      '';
    return role.toUpperCase();
  }

  private parseJwtPayload(token: string): Record<string, unknown> {
    try {
      const parts = token.split('.');
      if (parts.length < 2) return {};

      const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
      const decoded = Buffer.from(padded, 'base64').toString('utf8');
      const parsed = JSON.parse(decoded);
      return parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
}
