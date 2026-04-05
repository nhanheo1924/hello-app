import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request, Response } from "express";
import { randomUUID } from "crypto";
import { GatewayErrorDto } from "./dto/gateway-error.dto";
import { SyncService } from "../sync/sync.service";

type UpstreamType = "auth" | "task";

type ForwardOptions = {
  upstream: UpstreamType;
  upstreamPath: string;
};

type ForwardPolicy = {
  maxAttempts: number;
  retryDelayMs: number;
  timeoutMs: number;
};

type MutateAuthPayloadResult = {
  buffer: Buffer<ArrayBuffer>;
};

type TaskDeltaOperation = "create" | "update" | "move" | "delete";

type ResolvedTaskDelta = {
  operation: TaskDeltaOperation;
  taskId: string;
  projectId?: string;
  taskPatch?: Record<string, unknown> | null;
};

function parseJsonRecord(raw: string): Record<string, unknown> | null {
  const parsed: unknown = JSON.parse(raw);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const REQUEST_BLOCKED_HEADERS = new Set([
  ...HOP_BY_HOP_HEADERS,
  "content-length",
  "expect",
  "host",
]);

const RETRYABLE_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const ADMIN_USER_KEY = "admin:*";
const AUTH_CRITICAL_PATHS = new Set([
  "login",
  "signup",
  "register",
  "2fa/verify-login",
  "password",
]);
const AUTH_SESSION_ISSUE_PATHS = new Set([
  "login",
  "signup",
  "register",
  "2fa/verify-login",
  "oauth/exchange",
  "refresh",
]);
const TASK_OBSERVED_PATH_PREFIXES = [
  "workspaces",
  "projects",
  "tasks",
  "notifications/stream",
] as const;
const AUTH_ADMIN_PATH_PREFIX = "admin/";
const AUTH_REALTIME_PATHS = new Set([
  "login",
  "logout",
  "signup",
  "register",
  "2fa/verify-login",
  "password",
  "2fa/setup",
  "2fa/confirm",
  "2fa/disable",
]);

@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly syncService: SyncService,
  ) {}

  async forward(
    request: Request,
    response: Response,
    options: ForwardOptions,
  ): Promise<void> {
    const targetBaseUrl = this.resolveTargetBaseUrl(options.upstream);
    const normalizedUpstreamPath = this.normalizeUpstreamPath(
      options.upstreamPath,
    );
    const upstreamUrl = this.buildUpstreamUrl(
      targetBaseUrl,
      options.upstreamPath,
      request,
    );
    const policy = this.resolveForwardPolicy(options, normalizedUpstreamPath);
    const isSseRequest = this.isSseForwardRequest(request, options);
    const shouldLogTaskForward = this.shouldLogTaskForward(
      options,
      normalizedUpstreamPath,
    );

    const requestBody = this.buildRequestBody(request);
    const headers = this.buildForwardHeaders(request, options);

    let upstreamResponse: globalThis.Response | null = null;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeoutId =
        !isSseRequest && policy.timeoutMs > 0
          ? setTimeout(() => controller.abort(), policy.timeoutMs)
          : null;

      try {
        upstreamResponse = await fetch(upstreamUrl, {
          method: request.method,
          headers,
          body: requestBody,
          redirect: "manual",
          signal: controller.signal,
        });
        break;
      } catch (error) {
        lastError = error;
        if (!this.isRetryableError(error) || attempt >= policy.maxAttempts) {
          break;
        }

        if (policy.retryDelayMs > 0) {
          await this.sleep(policy.retryDelayMs * attempt);
        }
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    }

    if (!upstreamResponse) {
      const isTimeout =
        lastError instanceof Error && lastError.name === "AbortError";
      this.logForwardFailure({
        error: lastError,
        isTimeout,
        upstream: options.upstream,
        upstreamPath: options.upstreamPath,
        requestId: request.requestId,
      });
      const status = isTimeout ? 504 : 502;
      const payload: GatewayErrorDto = {
        code: isTimeout ? "GATEWAY_TIMEOUT" : "BAD_GATEWAY",
        message: isTimeout
          ? "Upstream request timed out"
          : "Upstream request failed",
        details: {
          upstream: options.upstream,
          requestId: request.requestId,
        },
      };
      if (shouldLogTaskForward) {
        this.logTaskForwardResult({
          request,
          upstreamPath: normalizedUpstreamPath,
          upstreamStatus: status,
          upstreamCode: payload.code,
          upstreamMessage: payload.message,
        });
      }

      response.status(status).json(payload);
      return;
    }

    response.status(upstreamResponse.status);
    this.copyUpstreamHeaders(upstreamResponse, response);
    const upstreamRequestId = String(
      upstreamResponse.headers.get("x-request-id") || "",
    ).trim();
    if (
      shouldLogTaskForward &&
      (isSseRequest || this.isSseResponse(upstreamResponse))
    ) {
      this.logTaskForwardResult({
        request,
        upstreamPath: normalizedUpstreamPath,
        upstreamStatus: upstreamResponse.status,
        upstreamRequestId,
      });
    }
    if (isSseRequest || this.isSseResponse(upstreamResponse)) {
      await this.pipeEventStream(upstreamResponse, response);
      return;
    }

    let buffer = Buffer.from(await upstreamResponse.arrayBuffer());
    if (options.upstream === "auth") {
      const handled = this.mutateAuthPayloadAndCookie({
        request,
        response,
        normalizedUpstreamPath,
        upstreamResponse,
        buffer,
      });
      buffer = handled.buffer;
    }
    const parsedUpstreamPayload = this.tryParseJsonBody(
      upstreamResponse,
      buffer,
    );
    if (shouldLogTaskForward) {
      const { code: upstreamCode, message: upstreamMessage } =
        this.extractUpstreamCodeAndMessage(parsedUpstreamPayload);
      this.logTaskForwardResult({
        request,
        upstreamPath: normalizedUpstreamPath,
        upstreamStatus: upstreamResponse.status,
        upstreamCode,
        upstreamMessage,
        upstreamRequestId,
      });
    }

    const workspaceId = this.resolveWorkspaceIdHint(
      request,
      options.upstreamPath,
      upstreamResponse,
      buffer,
    );

    await this.publishRealtimeUpdates({
      request,
      options,
      normalizedUpstreamPath,
      upstreamStatus: upstreamResponse.status,
      workspaceId,
      parsedUpstreamPayload,
    });

    response.end(buffer);
  }

  private isSseForwardRequest(
    request: Request,
    options: ForwardOptions,
  ): boolean {
    if (options.upstream !== "task") {
      return false;
    }

    const path = String(options.upstreamPath || "").replace(/^\/+/, "");
    if (!path.startsWith("notifications/stream")) {
      return false;
    }

    const acceptHeader = String(request.headers.accept || "").toLowerCase();
    return (
      acceptHeader.includes("text/event-stream") || request.method === "GET"
    );
  }

  private isSseResponse(response: globalThis.Response): boolean {
    const contentType = String(
      response.headers.get("content-type") || "",
    ).toLowerCase();
    return contentType.includes("text/event-stream");
  }

  private async pipeEventStream(
    upstreamResponse: globalThis.Response,
    response: Response,
  ): Promise<void> {
    const body = upstreamResponse.body;
    if (!body) {
      response.end();
      return;
    }

    const reader = body.getReader();
    response.on("close", () => {
      void reader.cancel().catch(() => undefined);
    });

    while (!response.writableEnded) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        response.write(Buffer.from(value));
      }
    }

    if (!response.writableEnded) {
      response.end();
    }
  }

  private async publishRealtimeUpdates(input: {
    request: Request;
    options: ForwardOptions;
    normalizedUpstreamPath: string;
    upstreamStatus: number;
    workspaceId?: string;
    parsedUpstreamPayload: Record<string, unknown> | null;
  }): Promise<void> {
    const {
      request,
      options,
      normalizedUpstreamPath,
      upstreamStatus,
      workspaceId,
      parsedUpstreamPayload,
    } = input;

    const taskDelta = this.resolveTaskDelta({
      method: request.method,
      normalizedUpstreamPath,
      upstreamStatus,
      payload: parsedUpstreamPayload,
    });
    const shouldPublishTaskInvalidate =
      this.shouldPublishInvalidate(request, options, upstreamStatus) &&
      this.isTaskMutationPath(request.method, normalizedUpstreamPath);
    const resolvedWorkspaceId =
      workspaceId ||
      (taskDelta?.projectId
        ? await this.fetchWorkspaceIdFromProject(request, taskDelta.projectId)
        : undefined);

    if (shouldPublishTaskInvalidate) {
      this.syncService.publishInvalidateFromRequest(request, {
        workspaceId: resolvedWorkspaceId,
        resource: "tasks",
      });
    }

    let workspaceUserKeys: string[] = [];
    if (shouldPublishTaskInvalidate && resolvedWorkspaceId) {
      workspaceUserKeys = await this.fetchWorkspaceMemberUserKeys(
        request,
        resolvedWorkspaceId,
      );
      if (workspaceUserKeys.length > 0) {
        this.syncService.publishInvalidateMany({
          userKeys: workspaceUserKeys,
          workspaceId: resolvedWorkspaceId,
          resource: "tasks",
        });
      }
    }

    if (taskDelta && workspaceUserKeys.length > 0) {
      this.syncService.publishWorkspaceTaskDelta({
        userKeys: workspaceUserKeys,
        workspaceId: resolvedWorkspaceId,
        projectId: taskDelta.projectId,
        taskId: taskDelta.taskId,
        operation: taskDelta.operation,
        taskPatch: taskDelta.taskPatch ?? null,
        occurredAt: Date.now(),
      });
    }

    const shouldPublishAdminInvalidate = this.shouldPublishAdminInvalidate(
      request,
      options,
      upstreamStatus,
    );
    if (shouldPublishAdminInvalidate) {
      const resource = this.resolveAdminInvalidateResource({
        options,
        normalizedUpstreamPath,
        taskDelta,
      });
      const operation = this.resolveAdminOperationFromHttpMethod(request.method);
      const payload = this.resolveAdminDeltaPayload(
        parsedUpstreamPayload,
        normalizedUpstreamPath,
        resolvedWorkspaceId,
      );

      this.syncService.publishInvalidate({
        userKey: ADMIN_USER_KEY,
        workspaceId: "*",
        resource,
      });
      this.syncService.publishAdminDelta({
        resource,
        operation,
        payload,
      });
    }

    const adminEvent = this.resolveAdminRealtimeEvent({
      request,
      options,
      normalizedUpstreamPath,
      upstreamStatus,
      payload: parsedUpstreamPayload,
      workspaceId: resolvedWorkspaceId,
      taskDelta,
    });
    if (adminEvent) {
      this.syncService.publishAdminEvent(adminEvent);
    }
  }

  private async fetchWorkspaceMemberUserKeys(
    request: Request,
    workspaceId: string,
  ): Promise<string[]> {
    const normalizedWorkspaceId = this.normalizeWorkspaceId(workspaceId);
    if (!normalizedWorkspaceId) {
      return [];
    }

    const taskBaseUrl = this.resolveTargetBaseUrl("task");
    const membersUrl = `${taskBaseUrl}/workspaces/${encodeURIComponent(normalizedWorkspaceId)}/members`;
    const headers = this.buildForwardHeaders(request, {
      upstream: "task",
      upstreamPath: `workspaces/${normalizedWorkspaceId}/members`,
    });

    try {
      const response = await fetch(membersUrl, {
        method: "GET",
        headers,
      });
      if (!response.ok) {
        return [];
      }

      const payload = await response.json().catch(() => null);
      const rows =
        payload &&
        typeof payload === "object" &&
        Array.isArray((payload as { data?: unknown[] }).data)
          ? (payload as { data: unknown[] }).data
          : [];

      const userKeys = rows
        .map((row) => {
          if (!row || typeof row !== "object") return "";
          const userId =
            "userId" in row && typeof row.userId === "string"
              ? row.userId
              : "";
          return this.syncService.buildUserKeyFromUserId(userId);
        })
        .filter((value) => value.length > 0);

      return Array.from(new Set(userKeys));
    } catch {
      return [];
    }
  }

  private async fetchWorkspaceIdFromProject(
    request: Request,
    projectId: string,
  ): Promise<string | undefined> {
    const normalizedProjectId = String(projectId || "").trim();
    if (!normalizedProjectId) {
      return undefined;
    }

    const taskBaseUrl = this.resolveTargetBaseUrl("task");
    const projectBoardUrl = `${taskBaseUrl}/projects/${encodeURIComponent(normalizedProjectId)}/board?page=1&limit=1`;
    const headers = this.buildForwardHeaders(request, {
      upstream: "task",
      upstreamPath: `projects/${normalizedProjectId}/board`,
    });

    try {
      const response = await fetch(projectBoardUrl, {
        method: "GET",
        headers,
      });
      if (!response.ok) {
        return undefined;
      }

      const payload = await response.json().catch(() => null);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return undefined;
      }

      return this.normalizeWorkspaceId(
        this.extractWorkspaceIdFromResponse(
          payload as Record<string, unknown>,
        ),
      );
    } catch {
      return undefined;
    }
  }

  private resolveTaskDelta(input: {
    method: string;
    normalizedUpstreamPath: string;
    upstreamStatus: number;
    payload: Record<string, unknown> | null;
  }): ResolvedTaskDelta | null {
    const method = String(input.method || "").toUpperCase();
    if (input.upstreamStatus < 200 || input.upstreamStatus >= 300) {
      return null;
    }

    const segments = String(input.normalizedUpstreamPath || "")
      .split("/")
      .filter((segment) => segment.length > 0);
    const data =
      input.payload &&
      typeof input.payload.data === "object" &&
      input.payload.data !== null &&
      !Array.isArray(input.payload.data)
        ? (input.payload.data as Record<string, unknown>)
        : null;

    const taskIdFromPayload =
      data && typeof data.id === "string" ? data.id.trim() : "";
    const projectIdFromPayload =
      data && typeof data.projectId === "string" ? data.projectId.trim() : "";

    if (
      method === "POST" &&
      segments.length >= 3 &&
      ((segments[0] === "workspaces" && segments[2] === "tasks") ||
        (segments[0] === "projects" && segments[2] === "tasks"))
    ) {
      if (!taskIdFromPayload) {
        return null;
      }
      return {
        operation: "create",
        taskId: taskIdFromPayload,
        projectId: projectIdFromPayload || undefined,
        taskPatch: data,
      };
    }

    if (method === "PATCH" && segments[0] === "tasks" && segments[1]) {
      return {
        operation: "update",
        taskId: taskIdFromPayload || segments[1],
        projectId: projectIdFromPayload || undefined,
        taskPatch: data,
      };
    }

    if (
      method === "POST" &&
      segments[0] === "tasks" &&
      segments[1] &&
      segments[2] === "move"
    ) {
      return {
        operation: "move",
        taskId: taskIdFromPayload || segments[1],
        projectId: projectIdFromPayload || undefined,
        taskPatch: data,
      };
    }

    if (method === "DELETE" && segments[0] === "tasks" && segments[1]) {
      return {
        operation: "delete",
        taskId: segments[1],
        projectId: projectIdFromPayload || undefined,
        taskPatch: null,
      };
    }

    return null;
  }

  private resolveAdminOperationFromHttpMethod(method: string): string {
    const normalizedMethod = String(method || "").toUpperCase();
    if (normalizedMethod === "POST") return "create";
    if (normalizedMethod === "DELETE") return "delete";
    if (normalizedMethod === "PATCH" || normalizedMethod === "PUT") {
      return "update";
    }
    return "unknown";
  }

  private resolveAdminDeltaPayload(
    payload: Record<string, unknown> | null,
    normalizedUpstreamPath: string,
    workspaceId?: string,
  ): Record<string, unknown> {
    const data =
      payload &&
      typeof payload.data === "object" &&
      payload.data !== null &&
      !Array.isArray(payload.data)
        ? (payload.data as Record<string, unknown>)
        : null;

    return {
      path: normalizedUpstreamPath,
      workspaceId: workspaceId || null,
      ...(data ? data : {}),
    };
  }

  private resolveAdminRealtimeEvent(input: {
    request: Request;
    options: ForwardOptions;
    normalizedUpstreamPath: string;
    upstreamStatus: number;
    payload: Record<string, unknown> | null;
    workspaceId?: string;
    taskDelta: ResolvedTaskDelta | null;
  }): Record<string, unknown> | null {
    const { options, normalizedUpstreamPath, upstreamStatus, payload } = input;
    const method = String(input.request.method || "").toUpperCase();
    const isMutation =
      method === "POST" || method === "PATCH" || method === "DELETE";
    const outcome =
      upstreamStatus >= 200 && upstreamStatus < 300 ? "success" : "failure";
    const code =
      payload && typeof payload.code === "string" ? payload.code : "";
    const message =
      payload && typeof payload.message === "string" ? payload.message : "";

    if (options.upstream === "auth") {
      const authPath = normalizedUpstreamPath.replace(/^auth\/?/, "");
      if (
        !AUTH_REALTIME_PATHS.has(authPath) &&
        !authPath.startsWith(AUTH_ADMIN_PATH_PREFIX)
      ) {
        return null;
      }
      if (!isMutation) {
        return null;
      }

      return {
        eventId: randomUUID(),
        timestamp: Date.now(),
        category: "auth",
        action: authPath || "auth.unknown",
        outcome,
        actor: null,
        targetType: authPath.startsWith("admin/users") ? "user" : "auth",
        targetId: this.resolveTargetIdFromPath(authPath),
        workspaceId: null,
        metadata: {
          method,
          status: upstreamStatus,
          code,
          message,
        },
      };
    }

    if (options.upstream !== "task") {
      return null;
    }
    if (!isMutation) {
      return null;
    }

    const category =
      input.taskDelta !== null
        ? "task"
        : normalizedUpstreamPath.includes("/members")
          ? "membership"
          : normalizedUpstreamPath.startsWith("workspaces/")
            ? "workspace"
            : normalizedUpstreamPath.startsWith("projects/")
              ? "project"
              : "task";

    return {
      eventId: randomUUID(),
      timestamp: Date.now(),
      category,
      action: normalizedUpstreamPath || "task.unknown",
      outcome,
      actor: null,
      targetType: input.taskDelta ? "task" : category,
      targetId: input.taskDelta?.taskId || this.resolveTargetIdFromPath(normalizedUpstreamPath),
      workspaceId: input.workspaceId || null,
      metadata: {
        method,
        status: upstreamStatus,
        code,
        message,
      },
    };
  }

  private resolveTargetIdFromPath(path: string): string | null {
    const segments = String(path || "")
      .split("/")
      .filter((segment) => segment.length > 0);
    if (segments.length < 2) {
      return null;
    }
    return segments[1] || null;
  }

  private shouldPublishInvalidate(
    request: Request,
    options: ForwardOptions,
    upstreamStatus: number,
  ): boolean {
    if (options.upstream !== "task") {
      return false;
    }

    const method = String(request.method || "").toUpperCase();
    const isMutation =
      method === "POST" || method === "PATCH" || method === "DELETE";
    if (!isMutation) {
      return false;
    }

    return upstreamStatus >= 200 && upstreamStatus < 300;
  }

  private isTaskMutationPath(method: string, normalizedUpstreamPath: string): boolean {
    const normalizedMethod = String(method || "").toUpperCase();
    const segments = String(normalizedUpstreamPath || "")
      .split("/")
      .filter((segment) => segment.length > 0);

    if (
      normalizedMethod === "POST" &&
      segments.length >= 3 &&
      ((segments[0] === "workspaces" && segments[2] === "tasks") ||
        (segments[0] === "projects" && segments[2] === "tasks"))
    ) {
      return true;
    }

    if (
      segments[0] === "tasks" &&
      segments[1] &&
      (normalizedMethod === "PATCH" || normalizedMethod === "DELETE")
    ) {
      return true;
    }

    if (
      normalizedMethod === "POST" &&
      segments[0] === "tasks" &&
      segments[1] &&
      segments[2] === "move"
    ) {
      return true;
    }

    return false;
  }

  private shouldPublishAdminInvalidate(
    request: Request,
    options: ForwardOptions,
    upstreamStatus: number,
  ): boolean {
    const method = String(request.method || "").toUpperCase();
    const isMutation =
      method === "POST" || method === "PATCH" || method === "DELETE";
    if (!isMutation) {
      return false;
    }
    if (upstreamStatus < 200 || upstreamStatus >= 300) {
      return false;
    }

    return options.upstream === "auth" || options.upstream === "task";
  }

  private resolveAdminInvalidateResource(input: {
    options: ForwardOptions;
    normalizedUpstreamPath: string;
    taskDelta: ResolvedTaskDelta | null;
  }): string {
    const { options, normalizedUpstreamPath, taskDelta } = input;
    if (options.upstream === "task") {
      if (taskDelta) {
        return "task";
      }
      if (normalizedUpstreamPath.includes("/members")) {
        return "membership";
      }
      if (normalizedUpstreamPath.startsWith("workspaces/")) {
        return "workspace";
      }
      if (normalizedUpstreamPath.startsWith("projects/")) {
        return "project";
      }
      return "task";
    }

    const path = normalizedUpstreamPath.replace(/^auth\/?/, "");
    if (path.startsWith("admin/users")) {
      return "user";
    }
    if (path.startsWith("admin/audit-logs")) {
      return "audit";
    }
    return "security";
  }

  private resolveForwardPolicy(
    options: ForwardOptions,
    normalizedUpstreamPath: string,
  ): ForwardPolicy {
    const defaultPolicy: ForwardPolicy = {
      maxAttempts: this.configService.get<number>("UPSTREAM_MAX_ATTEMPTS", 3),
      retryDelayMs: this.configService.get<number>(
        "UPSTREAM_RETRY_DELAY_MS",
        400,
      ),
      timeoutMs: this.configService.get<number>("UPSTREAM_TIMEOUT_MS", 15000),
    };

    if (
      options.upstream === "auth" &&
      AUTH_CRITICAL_PATHS.has(normalizedUpstreamPath)
    ) {
      return {
        maxAttempts: 1,
        retryDelayMs: 0,
        timeoutMs: this.configService.get<number>(
          "AUTH_CRITICAL_UPSTREAM_TIMEOUT_MS",
          8000,
        ),
      };
    }

    return defaultPolicy;
  }

  private normalizeUpstreamPath(path: string): string {
    return String(path || "")
      .trim()
      .replace(/^\/+|\/+$/g, "")
      .toLowerCase();
  }

  private resolveTargetBaseUrl(upstream: UpstreamType): string {
    if (upstream === "auth") {
      return String(
        this.configService.get<string>(
          "AUTH_SERVICE_BASE_URL",
          "http://localhost:3000/api/auth",
        ),
      )
        .trim()
        .replace(/\/+$/, "");
    }

    return String(
      this.configService.get<string>(
        "TASK_SERVICE_BASE_URL",
        "http://localhost:3002/api",
      ),
    )
      .trim()
      .replace(/\/+$/, "");
  }

  private buildUpstreamUrl(
    targetBaseUrl: string,
    upstreamPath: string,
    request: Request,
  ): string {
    const incoming = new URL(
      request.originalUrl || request.url || "/",
      "http://localhost",
    );
    const normalizedPath = String(upstreamPath || "").replace(/^\/+/, "");
    const base = normalizedPath
      ? `${targetBaseUrl}/${normalizedPath}`
      : targetBaseUrl;

    const upstream = new URL(base);
    upstream.search = incoming.search;
    return upstream.toString();
  }

  private buildForwardHeaders(
    request: Request,
    options: ForwardOptions,
  ): Headers {
    const headers = new Headers();

    for (const [name, value] of Object.entries(request.headers || {})) {
      if (value === undefined || value === null) {
        continue;
      }

      const normalizedName = String(name).toLowerCase();
      if (normalizedName === "cookie") {
        if (options.upstream === "auth") {
          if (Array.isArray(value)) {
            const joined = value.join("; ").trim();
            if (joined) {
              headers.set("cookie", joined);
            }
          } else {
            const cookieValue = String(value).trim();
            if (cookieValue) {
              headers.set("cookie", cookieValue);
            }
          }
        }
        continue;
      }
      if (REQUEST_BLOCKED_HEADERS.has(normalizedName)) {
        continue;
      }

      if (Array.isArray(value)) {
        headers.set(name, value.join(", "));
      } else {
        headers.set(name, String(value));
      }
    }

    if (!headers.has("authorization")) {
      const tokenFromCookie = this.extractAccessTokenFromCookie(request);
      if (tokenFromCookie) {
        headers.set("authorization", `Bearer ${tokenFromCookie}`);
      }
    }

    const internalProxySecret = String(
      this.configService.get<string>("INTERNAL_PROXY_SECRET", ""),
    ).trim();
    if (internalProxySecret) {
      headers.set("x-proxy-secret", internalProxySecret);
    }

    if (request.requestId) {
      headers.set("x-request-id", request.requestId);
    }

    headers.set("x-forwarded-host", String(request.headers.host || ""));
    headers.set(
      "x-forwarded-proto",
      String(request.headers["x-forwarded-proto"] || "https"),
    );

    return headers;
  }

  private mutateAuthPayloadAndCookie(input: {
    request: Request;
    response: Response;
    normalizedUpstreamPath: string;
    upstreamResponse: globalThis.Response;
    buffer: Buffer;
  }): MutateAuthPayloadResult {
    const {
      request,
      response,
      normalizedUpstreamPath,
      upstreamResponse,
      buffer,
    } = input;
    const baseBuffer = buffer as Buffer<ArrayBuffer>;

    if (normalizedUpstreamPath === "logout") {
      this.clearAccessTokenCookie(response, request);
      this.clearRefreshTokenCookie(response, request);
      return { buffer: baseBuffer };
    }

    if (!AUTH_SESSION_ISSUE_PATHS.has(normalizedUpstreamPath)) {
      return { buffer: baseBuffer };
    }

    const payload = this.tryParseJsonBody(upstreamResponse, buffer);
    if (!payload) {
      return { buffer: baseBuffer };
    }

    if (upstreamResponse.status < 200 || upstreamResponse.status >= 300) {
      return { buffer: baseBuffer };
    }

    if (payload.requiresTwoFactor === true) {
      this.clearAccessTokenCookie(response, request);
      this.clearRefreshTokenCookie(response, request);
      return { buffer: baseBuffer };
    }

    const accessToken =
      typeof payload.accessToken === "string" ? payload.accessToken.trim() : "";
    if (!accessToken) {
      return { buffer: baseBuffer };
    }

    const expiresInSeconds = Number(payload.expiresIn);
    this.setAccessTokenCookie(response, request, accessToken, expiresInSeconds);

    const refreshToken =
      typeof payload.refreshToken === "string"
        ? payload.refreshToken.trim()
        : "";
    const refreshExpiresInSeconds = Number(payload.refreshExpiresIn);
    if (refreshToken) {
      this.setRefreshTokenCookie(
        response,
        request,
        refreshToken,
        refreshExpiresInSeconds,
      );
    }

    delete payload.accessToken;
    delete payload.refreshToken;
    delete payload.refreshExpiresIn;
    return {
      buffer: Buffer.from(JSON.stringify(payload)),
    };
  }

  private extractAccessTokenFromCookie(request: Request): string {
    const cookieName = this.getAccessTokenCookieName();
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const token =
      cookies && typeof cookies[cookieName] === "string"
        ? String(cookies[cookieName]).trim()
        : "";
    return token;
  }

  private setAccessTokenCookie(
    response: Response,
    request: Request,
    token: string,
    expiresInSeconds: number,
  ): void {
    const maxAgeMs =
      Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
        ? Math.floor(expiresInSeconds * 1000)
        : 60 * 60 * 1000;

    response.cookie(this.getAccessTokenCookieName(), token, {
      ...this.getAccessTokenCookieBaseOptions(request),
      maxAge: maxAgeMs,
    });
  }

  private clearAccessTokenCookie(response: Response, request: Request): void {
    response.clearCookie(
      this.getAccessTokenCookieName(),
      this.getAccessTokenCookieBaseOptions(request),
    );
  }

  private setRefreshTokenCookie(
    response: Response,
    request: Request,
    token: string,
    expiresInSeconds: number,
  ): void {
    const maxAgeMs =
      Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
        ? Math.floor(expiresInSeconds * 1000)
        : 3 * 24 * 60 * 60 * 1000;
    response.cookie(this.getRefreshTokenCookieName(), token, {
      ...this.getAccessTokenCookieBaseOptions(request),
      maxAge: maxAgeMs,
    });
  }

  private clearRefreshTokenCookie(response: Response, request: Request): void {
    response.clearCookie(
      this.getRefreshTokenCookieName(),
      this.getAccessTokenCookieBaseOptions(request),
    );
  }

  private getAccessTokenCookieName(): string {
    const configured = String(
      this.configService.get<string>("AUTH_ACCESS_COOKIE_NAME", "ctm_at"),
    ).trim();
    return configured || "ctm_at";
  }

  private getRefreshTokenCookieName(): string {
    const configured = String(
      this.configService.get<string>("AUTH_REFRESH_COOKIE_NAME", "ctm_rt"),
    ).trim();
    return configured || "ctm_rt";
  }

  private getAccessTokenCookieBaseOptions(request: Request): {
    httpOnly: true;
    secure: boolean;
    sameSite: "lax" | "strict" | "none";
    path: string;
    domain?: string;
  } {
    const configuredSameSite = String(
      this.configService.get<string>("AUTH_ACCESS_COOKIE_SAMESITE", "lax"),
    )
      .trim()
      .toLowerCase();
    const sameSite: "lax" | "strict" | "none" =
      configuredSameSite === "strict" ||
      configuredSameSite === "lax" ||
      configuredSameSite === "none"
        ? configuredSameSite
        : "lax";
    const nodeEnv = String(
      this.configService.get<string>("NODE_ENV", "development"),
    ).trim();
    const requiresCrossOriginCookie = this.shouldUseCrossOriginCookiePolicy(
      request,
    );
    const preferredSameSite: "lax" | "strict" | "none" =
      requiresCrossOriginCookie ? "none" : sameSite;
    const isHttpsRequest =
      request.secure ||
      String(request.headers["x-forwarded-proto"] || "")
        .toLowerCase()
        .includes("https");
    const secure =
      nodeEnv === "production"
        ? true
        : preferredSameSite === "none" && isHttpsRequest;
    const effectiveSameSite: "lax" | "strict" | "none" =
      preferredSameSite === "none" && !secure ? "strict" : preferredSameSite;
    const domain = this.resolveCookieDomain(request);

    if (domain) {
      return {
        httpOnly: true,
        secure,
        sameSite: effectiveSameSite,
        path: "/",
        domain,
      };
    }

    return {
      httpOnly: true,
      secure,
      sameSite: effectiveSameSite,
      path: "/",
    };
  }

  private shouldUseCrossOriginCookiePolicy(request: Request): boolean {
    const rawOrigin = String(request.headers.origin || "").trim();
    if (!rawOrigin) {
      return false;
    }

    let originHost = "";
    try {
      originHost = this.normalizeHost(new URL(rawOrigin).host);
    } catch {
      return false;
    }
    if (!originHost) {
      return false;
    }

    const requestHost = this.resolvePublicRequestHost(request);
    if (!requestHost) {
      return false;
    }

    return originHost !== requestHost;
  }

  private resolveCookieDomain(request: Request): string {
    const configuredDomain = String(
      this.configService.get<string>("AUTH_ACCESS_COOKIE_DOMAIN", ""),
    )
      .trim()
      .toLowerCase();
    if (!configuredDomain) {
      return "";
    }

    const normalizedDomain = configuredDomain.replace(/^\./, "");
    if (!normalizedDomain) {
      return "";
    }

    const requestHost = this.resolvePublicRequestHost(request);
    if (!requestHost) {
      return "";
    }

    const isMatchingDomain =
      requestHost === normalizedDomain ||
      requestHost.endsWith(`.${normalizedDomain}`);
    if (!isMatchingDomain) {
      return "";
    }

    return configuredDomain.startsWith(".")
      ? configuredDomain
      : `.${configuredDomain}`;
  }

  private resolvePublicRequestHost(request: Request): string {
    const forwardedHost = this.parseHostHeader(request.headers["x-forwarded-host"]);
    if (forwardedHost) {
      return forwardedHost;
    }

    const hostHeader = this.parseHostHeader(request.headers.host);
    if (hostHeader) {
      return hostHeader;
    }

    return this.normalizeHost(String(request.hostname || ""));
  }

  private parseHostHeader(rawHost: unknown): string {
    if (Array.isArray(rawHost) && rawHost.length > 0) {
      return this.normalizeHost(String(rawHost[0]));
    }
    if (typeof rawHost !== "string") {
      return "";
    }

    const firstHost = rawHost.split(",")[0];
    return this.normalizeHost(firstHost);
  }

  private normalizeHost(rawHost: string): string {
    const candidate = String(rawHost || "").trim().toLowerCase();
    if (!candidate) {
      return "";
    }

    if (candidate.startsWith("[")) {
      const closingBracket = candidate.indexOf("]");
      return closingBracket > 0
        ? candidate.slice(0, closingBracket + 1)
        : candidate;
    }

    return candidate.replace(/:\d+$/, "");
  }

  private resolveWorkspaceIdHint(
    request: Request,
    upstreamPath: string,
    upstreamResponse: globalThis.Response,
    responseBuffer: Buffer,
  ): string | undefined {
    const fromHeader = this.normalizeWorkspaceId(
      this.extractStringValue(request.headers["x-workspace-id"]),
    );
    if (fromHeader) return fromHeader;

    const fromQuery = this.normalizeWorkspaceId(
      this.extractStringValue(request.query?.workspaceId),
    );
    if (fromQuery) return fromQuery;

    const body = request.body as Record<string, unknown> | undefined;
    const fromBody = this.normalizeWorkspaceId(
      this.extractStringValue(body?.workspaceId),
    );
    if (fromBody) return fromBody;

    const fromPath = this.resolveWorkspaceIdFromPath(upstreamPath);
    if (fromPath) return fromPath;

    const parsedJson = this.tryParseJsonBody(upstreamResponse, responseBuffer);
    const fromResponse = this.normalizeWorkspaceId(
      this.extractWorkspaceIdFromResponse(parsedJson),
    );
    if (fromResponse) return fromResponse;

    return undefined;
  }

  private resolveWorkspaceIdFromPath(upstreamPath: string): string | undefined {
    const normalized = String(upstreamPath || "").replace(/^\/+/, "");
    const segments = normalized.split("/").filter((part) => part.length > 0);
    if (segments.length >= 2 && segments[0] === "workspaces") {
      return this.normalizeWorkspaceId(segments[1]);
    }
    return undefined;
  }

  private tryParseJsonBody(
    upstreamResponse: globalThis.Response,
    responseBuffer: Buffer,
  ): Record<string, unknown> | null {
    const contentType = String(
      upstreamResponse.headers.get("content-type") || "",
    ).toLowerCase();
    if (!contentType.includes("application/json")) {
      return null;
    }

    try {
      return parseJsonRecord(responseBuffer.toString("utf8"));
    } catch {
      return null;
    }
  }

  private extractWorkspaceIdFromResponse(
    payload: Record<string, unknown> | null,
  ): string {
    if (!payload) return "";

    const direct = this.extractStringValue(payload.workspaceId);
    if (direct) return direct;

    const data = payload.data as Record<string, unknown> | undefined;
    const fromData = this.extractStringValue(data?.workspaceId);
    if (fromData) return fromData;

    const project = data?.project as Record<string, unknown> | undefined;
    const fromProject = this.extractStringValue(project?.workspaceId);
    if (fromProject) return fromProject;

    return "";
  }

  private extractStringValue(value: unknown): string {
    if (typeof value === "string") {
      return value.trim();
    }
    if (Array.isArray(value) && typeof value[0] === "string") {
      return value[0].trim();
    }
    return "";
  }

  private normalizeWorkspaceId(value: string): string | undefined {
    const candidate = String(value || "").trim();
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        candidate,
      )
    ) {
      return candidate;
    }
    return undefined;
  }

  private buildRequestBody(request: Request): BodyInit | undefined {
    if (request.method === "GET" || request.method === "HEAD") {
      return undefined;
    }

    const body: unknown = request.body;
    if (body === undefined || body === null) {
      return undefined;
    }

    if (Buffer.isBuffer(body)) {
      return body as BodyInit;
    }

    if (typeof body === "string") {
      return body;
    }

    if (typeof body === "object") {
      return JSON.stringify(body);
    }

    return undefined;
  }

  private copyUpstreamHeaders(
    upstreamResponse: globalThis.Response,
    response: Response,
  ): void {
    const setCookies =
      typeof upstreamResponse.headers.getSetCookie === "function"
        ? upstreamResponse.headers.getSetCookie()
        : [];

    if (setCookies.length > 0) {
      response.setHeader("set-cookie", setCookies);
    } else {
      const singleSetCookie = upstreamResponse.headers.get("set-cookie");
      if (singleSetCookie) {
        response.setHeader("set-cookie", singleSetCookie);
      }
    }

    upstreamResponse.headers.forEach((value, name) => {
      const normalizedName = name.toLowerCase();
      if (
        normalizedName === "set-cookie" ||
        HOP_BY_HOP_HEADERS.has(normalizedName)
      ) {
        return;
      }
      response.setHeader(name, value);
    });
  }

  private isRetryableError(error: unknown): boolean {
    const code = this.extractErrorCode(error);
    if (code && RETRYABLE_ERROR_CODES.has(code)) {
      return true;
    }

    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (
      message.includes("fetch failed") ||
      message.includes("connect timeout")
    ) {
      return true;
    }

    return false;
  }

  private extractErrorCode(error: unknown): string {
    if (!error || typeof error !== "object") {
      return "";
    }

    if ("code" in error && typeof error.code === "string") {
      return error.code;
    }

    const cause = "cause" in error ? error.cause : undefined;
    if (
      cause &&
      typeof cause === "object" &&
      "code" in cause &&
      typeof cause.code === "string"
    ) {
      return cause.code;
    }

    return "";
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private logForwardFailure(input: {
    error: unknown;
    isTimeout: boolean;
    upstream: UpstreamType;
    upstreamPath: string;
    requestId?: string;
  }): void {
    const { error, isTimeout, upstream, upstreamPath, requestId } = input;
    const code = this.extractErrorCode(error);
    const name = error instanceof Error ? error.name : "UnknownError";
    const message =
      error instanceof Error ? error.message : this.stringifyLogValue(error);
    const requestIdText = requestId ? ` request_id=${requestId}` : "";

    this.logger.warn(
      `${isTimeout ? "timeout" : "failure"} upstream=${upstream} path=${upstreamPath || "/"} code=${code || "n/a"} name=${name} message="${message}"${requestIdText}`,
    );
  }

  private shouldLogTaskForward(
    options: ForwardOptions,
    normalizedUpstreamPath: string,
  ): boolean {
    if (options.upstream !== "task") {
      return false;
    }

    return TASK_OBSERVED_PATH_PREFIXES.some(
      (prefix) =>
        normalizedUpstreamPath === prefix ||
        normalizedUpstreamPath.startsWith(`${prefix}/`),
    );
  }

  private extractUpstreamCodeAndMessage(
    payload: Record<string, unknown> | null,
  ): {
    code: string;
    message: string;
  } {
    if (!payload) {
      return { code: "", message: "" };
    }

    const codeValue = payload.code;
    const messageValue = payload.message ?? payload.error;
    const code = typeof codeValue === "string" ? codeValue.trim() : "";
    const message = typeof messageValue === "string" ? messageValue.trim() : "";
    return {
      code,
      message: message.replace(/\s+/g, " ").slice(0, 180),
    };
  }

  private logTaskForwardResult(input: {
    request: Request;
    upstreamPath: string;
    upstreamStatus: number;
    upstreamCode?: string;
    upstreamMessage?: string;
    upstreamRequestId?: string;
  }): void {
    const {
      request,
      upstreamPath,
      upstreamStatus,
      upstreamCode,
      upstreamMessage,
      upstreamRequestId,
    } = input;
    const details = [
      `method=${String(request.method || "").toUpperCase() || "GET"}`,
      `path=${upstreamPath || "/"}`,
      `upstream_status=${upstreamStatus}`,
      `request_id=${request.requestId || "n/a"}`,
      upstreamRequestId ? `upstream_request_id=${upstreamRequestId}` : "",
      upstreamCode ? `upstream_code=${upstreamCode}` : "",
      upstreamMessage ? `upstream_message="${upstreamMessage}"` : "",
    ]
      .filter((part) => part.length > 0)
      .join(" ");

    this.logger.log(`task_forward ${details}`);
  }

  private stringifyLogValue(value: unknown): string {
    if (
      value === undefined ||
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      typeof value === "bigint"
    ) {
      return String(value ?? "");
    }

    try {
      return JSON.stringify(value);
    } catch {
      return "[unserializable]";
    }
  }
}
