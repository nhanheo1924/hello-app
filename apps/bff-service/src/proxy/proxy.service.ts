import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { GatewayErrorDto } from './dto/gateway-error.dto';
import { SyncService } from '../sync/sync.service';

type UpstreamType = 'auth' | 'task';

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

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const RETRYABLE_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

const ADMIN_USER_KEY = 'admin:*';
const AUTH_CRITICAL_PATHS = new Set([
  'login',
  'signup',
  'register',
  '2fa/verify-login',
  'password',
]);
const AUTH_SESSION_ISSUE_PATHS = new Set([
  'login',
  'signup',
  'register',
  '2fa/verify-login',
  'oauth/exchange',
]);

@Injectable()
export class ProxyService {
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
    const policy = this.resolveForwardPolicy(
      options,
      normalizedUpstreamPath,
    );
    const isSseRequest = this.isSseForwardRequest(request, options);

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
          redirect: 'manual',
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
        lastError instanceof Error && lastError.name === 'AbortError';
      const status = isTimeout ? 504 : 502;
      const payload: GatewayErrorDto = {
        code: isTimeout ? 'GATEWAY_TIMEOUT' : 'BAD_GATEWAY',
        message: isTimeout
          ? 'Upstream request timed out'
          : 'Upstream request failed',
        details: {
          upstream: options.upstream,
          requestId: request.requestId,
        },
      };

      response.status(status).json(payload);
      return;
    }

    response.status(upstreamResponse.status);
    this.copyUpstreamHeaders(upstreamResponse, response);
    if (isSseRequest || this.isSseResponse(upstreamResponse)) {
      await this.pipeEventStream(upstreamResponse, response);
      return;
    }

    let buffer = Buffer.from(await upstreamResponse.arrayBuffer());
    if (options.upstream === 'auth') {
      const handled = this.mutateAuthPayloadAndCookie({
        request,
        response,
        normalizedUpstreamPath,
        upstreamResponse,
        buffer,
      });
      buffer = handled.buffer;
    }

    if (this.shouldPublishInvalidate(request, options, upstreamResponse.status)) {
      const workspaceId = this.resolveWorkspaceIdHint(
        request,
        options.upstreamPath,
        upstreamResponse,
        buffer,
      );

      this.syncService.publishInvalidateFromRequest(request, {
        workspaceId,
        resource: 'tasks',
      });
    }

    if (this.shouldPublishAdminInvalidate(request, options, upstreamResponse.status)) {
      this.syncService.publishInvalidate({
        userKey: ADMIN_USER_KEY,
        workspaceId: '*',
        resource: this.resolveAdminInvalidateResource(options),
      });
    }

    response.end(buffer);
  }

  private isSseForwardRequest(request: Request, options: ForwardOptions): boolean {
    if (options.upstream !== 'task') {
      return false;
    }

    const path = String(options.upstreamPath || '').replace(/^\/+/, '');
    if (!path.startsWith('notifications/stream')) {
      return false;
    }

    const acceptHeader = String(request.headers.accept || '').toLowerCase();
    return acceptHeader.includes('text/event-stream') || request.method === 'GET';
  }

  private isSseResponse(response: globalThis.Response): boolean {
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    return contentType.includes('text/event-stream');
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
    response.on('close', () => {
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

  private shouldPublishInvalidate(
    request: Request,
    options: ForwardOptions,
    upstreamStatus: number,
  ): boolean {
    if (options.upstream !== 'task') {
      return false;
    }

    const method = String(request.method || '').toUpperCase();
    const isMutation =
      method === 'POST' || method === 'PATCH' || method === 'DELETE';
    if (!isMutation) {
      return false;
    }

    return upstreamStatus >= 200 && upstreamStatus < 300;
  }

  private shouldPublishAdminInvalidate(
    request: Request,
    options: ForwardOptions,
    upstreamStatus: number,
  ): boolean {
    const method = String(request.method || '').toUpperCase();
    const isMutation =
      method === 'POST' || method === 'PATCH' || method === 'DELETE';
    if (!isMutation) {
      return false;
    }
    if (upstreamStatus < 200 || upstreamStatus >= 300) {
      return false;
    }

    return options.upstream === 'auth' || options.upstream === 'task';
  }

  private resolveAdminInvalidateResource(options: ForwardOptions): string {
    if (options.upstream === 'task') {
      return 'admin.tasks';
    }

    const path = String(options.upstreamPath || '').replace(/^\/+/, '');
    if (path.startsWith('admin/users')) {
      return 'admin.users';
    }
    if (path.startsWith('admin/audit-logs')) {
      return 'admin.audit';
    }
    return 'admin.security';
  }

  private resolveForwardPolicy(
    options: ForwardOptions,
    normalizedUpstreamPath: string,
  ): ForwardPolicy {
    const defaultPolicy: ForwardPolicy = {
      maxAttempts: this.configService.get<number>('UPSTREAM_MAX_ATTEMPTS', 3),
      retryDelayMs: this.configService.get<number>('UPSTREAM_RETRY_DELAY_MS', 400),
      timeoutMs: this.configService.get<number>('UPSTREAM_TIMEOUT_MS', 15000),
    };

    if (
      options.upstream === 'auth' &&
      AUTH_CRITICAL_PATHS.has(normalizedUpstreamPath)
    ) {
      return {
        maxAttempts: 1,
        retryDelayMs: 0,
        timeoutMs: this.configService.get<number>(
          'AUTH_CRITICAL_UPSTREAM_TIMEOUT_MS',
          8000,
        ),
      };
    }

    return defaultPolicy;
  }

  private normalizeUpstreamPath(path: string): string {
    return String(path || '')
      .trim()
      .replace(/^\/+|\/+$/g, '')
      .toLowerCase();
  }

  private resolveTargetBaseUrl(upstream: UpstreamType): string {
    if (upstream === 'auth') {
      return String(
        this.configService.get<string>(
          'AUTH_SERVICE_BASE_URL',
          'http://localhost:3000/api/auth',
        ),
      )
        .trim()
        .replace(/\/+$/, '');
    }

    return String(
      this.configService.get<string>(
        'TASK_SERVICE_BASE_URL',
        'http://localhost:3102/api',
      ),
    )
      .trim()
      .replace(/\/+$/, '');
  }

  private buildUpstreamUrl(
    targetBaseUrl: string,
    upstreamPath: string,
    request: Request,
  ): string {
    const incoming = new URL(
      request.originalUrl || request.url || '/',
      'http://localhost',
    );
    const normalizedPath = String(upstreamPath || '').replace(/^\/+/, '');
    const base = normalizedPath
      ? `${targetBaseUrl}/${normalizedPath}`
      : targetBaseUrl;

    const upstream = new URL(base);
    upstream.search = incoming.search;
    return upstream.toString();
  }

  private buildForwardHeaders(
    request: Request,
    _options: ForwardOptions,
  ): Headers {
    const headers = new Headers();

    for (const [name, value] of Object.entries(request.headers || {})) {
      if (value === undefined || value === null) {
        continue;
      }

      const normalizedName = String(name).toLowerCase();
      if (
        normalizedName === 'host' ||
        normalizedName === 'connection' ||
        normalizedName === 'content-length' ||
        normalizedName === 'cookie'
      ) {
        continue;
      }

      if (Array.isArray(value)) {
        headers.set(name, value.join(', '));
      } else {
        headers.set(name, String(value));
      }
    }

    if (!headers.has('authorization')) {
      const tokenFromCookie = this.extractAccessTokenFromCookie(request);
      if (tokenFromCookie) {
        headers.set('authorization', `Bearer ${tokenFromCookie}`);
      }
    }

    const internalProxySecret = String(
      this.configService.get<string>('INTERNAL_PROXY_SECRET', ''),
    ).trim();
    if (internalProxySecret) {
      headers.set('x-proxy-secret', internalProxySecret);
    }

    if (request.requestId) {
      headers.set('x-request-id', request.requestId);
    }

    headers.set('x-forwarded-host', String(request.headers.host || ''));
    headers.set(
      'x-forwarded-proto',
      String(request.headers['x-forwarded-proto'] || 'https'),
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

    if (normalizedUpstreamPath === 'logout') {
      this.clearAccessTokenCookie(response, request);
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
      return { buffer: baseBuffer };
    }

    const accessToken =
      typeof payload.accessToken === 'string' ? payload.accessToken.trim() : '';
    if (!accessToken) {
      return { buffer: baseBuffer };
    }

    const expiresInSeconds = Number(payload.expiresIn);
    this.setAccessTokenCookie(response, request, accessToken, expiresInSeconds);

    delete payload.accessToken;
    return {
      buffer: Buffer.from(JSON.stringify(payload)) as Buffer<ArrayBuffer>,
    };
  }

  private extractAccessTokenFromCookie(request: Request): string {
    const cookieName = this.getAccessTokenCookieName();
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const token = cookies && typeof cookies[cookieName] === 'string'
      ? String(cookies[cookieName]).trim()
      : '';
    return token;
  }

  private setAccessTokenCookie(
    response: Response,
    request: Request,
    token: string,
    expiresInSeconds: number,
  ): void {
    const maxAgeMs = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
      ? Math.floor(expiresInSeconds * 1000)
      : 60 * 60 * 1000;

    response.cookie(
      this.getAccessTokenCookieName(),
      token,
      {
        ...this.getAccessTokenCookieBaseOptions(request),
        maxAge: maxAgeMs,
      },
    );
  }

  private clearAccessTokenCookie(response: Response, request: Request): void {
    response.clearCookie(
      this.getAccessTokenCookieName(),
      this.getAccessTokenCookieBaseOptions(request),
    );
  }

  private getAccessTokenCookieName(): string {
    const configured = String(
      this.configService.get<string>('AUTH_ACCESS_COOKIE_NAME', 'ctm_at'),
    ).trim();
    return configured || 'ctm_at';
  }

  private getAccessTokenCookieBaseOptions(request: Request): {
    httpOnly: true;
    secure: boolean;
    sameSite: 'lax' | 'strict' | 'none';
    path: string;
    domain?: string;
  } {
    const configuredSameSite = String(
      this.configService.get<string>('AUTH_ACCESS_COOKIE_SAMESITE', 'strict'),
    )
      .trim()
      .toLowerCase();
    const sameSite: 'lax' | 'strict' | 'none' =
      configuredSameSite === 'lax' || configuredSameSite === 'none'
        ? configuredSameSite
        : 'strict';
    const nodeEnv = String(this.configService.get<string>('NODE_ENV', 'development')).trim();
    const isHttpsRequest =
      request.secure ||
      String(request.headers['x-forwarded-proto'] || '')
        .toLowerCase()
        .includes('https');
    const secure = nodeEnv === 'production' ? true : sameSite === 'none' && isHttpsRequest;
    const effectiveSameSite: 'lax' | 'strict' | 'none' =
      sameSite === 'none' && !secure ? 'strict' : sameSite;
    const domain = String(
      this.configService.get<string>('AUTH_ACCESS_COOKIE_DOMAIN', ''),
    ).trim();

    if (domain) {
      return {
        httpOnly: true,
        secure,
        sameSite: effectiveSameSite,
        path: '/',
        domain,
      };
    }

    return {
      httpOnly: true,
      secure,
      sameSite: effectiveSameSite,
      path: '/',
    };
  }

  private resolveWorkspaceIdHint(
    request: Request,
    upstreamPath: string,
    upstreamResponse: globalThis.Response,
    responseBuffer: Buffer,
  ): string | undefined {
    const fromHeader = this.normalizeWorkspaceId(
      this.extractStringValue(request.headers['x-workspace-id']),
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
    const normalized = String(upstreamPath || '').replace(/^\/+/, '');
    const segments = normalized.split('/').filter((part) => part.length > 0);
    if (segments.length >= 2 && segments[0] === 'workspaces') {
      return this.normalizeWorkspaceId(segments[1]);
    }
    return undefined;
  }

  private tryParseJsonBody(
    upstreamResponse: globalThis.Response,
    responseBuffer: Buffer,
  ): Record<string, unknown> | null {
    const contentType = String(
      upstreamResponse.headers.get('content-type') || '',
    ).toLowerCase();
    if (!contentType.includes('application/json')) {
      return null;
    }

    try {
      const parsed = JSON.parse(responseBuffer.toString('utf8'));
      return parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  private extractWorkspaceIdFromResponse(
    payload: Record<string, unknown> | null,
  ): string {
    if (!payload) return '';

    const direct = this.extractStringValue(payload.workspaceId);
    if (direct) return direct;

    const data = payload.data as Record<string, unknown> | undefined;
    const fromData = this.extractStringValue(data?.workspaceId);
    if (fromData) return fromData;

    const project = data?.project as Record<string, unknown> | undefined;
    const fromProject = this.extractStringValue(project?.workspaceId);
    if (fromProject) return fromProject;

    return '';
  }

  private extractStringValue(value: unknown): string {
    if (typeof value === 'string') {
      return value.trim();
    }
    if (Array.isArray(value) && typeof value[0] === 'string') {
      return value[0].trim();
    }
    return '';
  }

  private normalizeWorkspaceId(value: string): string | undefined {
    const candidate = String(value || '').trim();
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
    if (request.method === 'GET' || request.method === 'HEAD') {
      return undefined;
    }

    const body = request.body;
    if (body === undefined || body === null) {
      return undefined;
    }

    if (Buffer.isBuffer(body)) {
      return body as BodyInit;
    }

    if (typeof body === 'string') {
      return body;
    }

    if (typeof body === 'object') {
      return JSON.stringify(body);
    }

    return undefined;
  }

  private copyUpstreamHeaders(
    upstreamResponse: globalThis.Response,
    response: Response,
  ): void {
    const setCookies =
      typeof upstreamResponse.headers.getSetCookie === 'function'
        ? upstreamResponse.headers.getSetCookie()
        : [];

    if (setCookies.length > 0) {
      response.setHeader('set-cookie', setCookies);
    } else {
      const singleSetCookie = upstreamResponse.headers.get('set-cookie');
      if (singleSetCookie) {
        response.setHeader('set-cookie', singleSetCookie);
      }
    }

    upstreamResponse.headers.forEach((value, name) => {
      const normalizedName = name.toLowerCase();
      if (
        normalizedName === 'set-cookie' ||
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

    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (message.includes('fetch failed') || message.includes('connect timeout')) {
      return true;
    }

    return false;
  }

  private extractErrorCode(error: unknown): string {
    if (!error || typeof error !== 'object') {
      return '';
    }

    if ('code' in error && typeof error.code === 'string') {
      return error.code;
    }

    const cause = 'cause' in error ? error.cause : undefined;
    if (cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string') {
      return cause.code;
    }

    return '';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
