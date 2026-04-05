import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "crypto";
import { Request } from "express";
import { JwksService } from "./jwks.service";

type AuthPayload = {
  sub: string;
  sid: string;
  email?: string;
  systemRole?: string;
  exp?: number;
};

type AuthValidationResult =
  | { ok: true; payload: AuthPayload }
  | {
      ok: false;
      code:
        | "AUTH_TOKEN_MISSING"
        | "AUTH_SESSION_INVALID"
        | "AUTH_UPSTREAM_UNAVAILABLE";
      message: string;
    };

type AuthValidationCacheEntry = {
  payload: AuthPayload;
  expiresAt: number;
  staleUntil: number;
};

const DEFAULT_AUTH_ME_CACHE_TTL_MS = 15_000;
const DEFAULT_AUTH_ME_STALE_GRACE_MS = 120_000;
const MAX_AUTH_VALIDATION_CACHE_ENTRIES = 2_000;

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);
  private readonly authServiceBaseUrl: string;
  private readonly internalProxySecret: string;
  private readonly authValidationCache = new Map<string, AuthValidationCacheEntry>();
  private readonly authValidationInFlight = new Map<
    string,
    Promise<AuthValidationResult>
  >();
  private readonly authMeCacheTtlMs: number;
  private readonly authMeStaleGraceMs: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly jwksService: JwksService,
  ) {
    this.authServiceBaseUrl = String(
      this.configService.get<string>(
        "AUTH_SERVICE_BASE_URL",
        "http://localhost:3000/api/auth",
      ),
    )
      .trim()
      .replace(/\/+$/, "");
    this.internalProxySecret = String(
      this.configService.get<string>("INTERNAL_PROXY_SECRET", ""),
    ).trim();
    this.authMeCacheTtlMs = this.readDurationMs(
      "AUTH_ME_CACHE_TTL_MS",
      DEFAULT_AUTH_ME_CACHE_TTL_MS,
    );
    this.authMeStaleGraceMs = this.readDurationMs(
      "AUTH_ME_STALE_GRACE_MS",
      DEFAULT_AUTH_ME_STALE_GRACE_MS,
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractBearerToken(request);
    const requestId = request.requestId || "n/a";

    if (!token) {
      this.logAuthFailure({
        code: "AUTH_TOKEN_MISSING",
        requestId,
        reason: "missing_bearer_token",
      });
      throw new UnauthorizedException({
        code: "AUTH_TOKEN_MISSING",
        message: "Missing bearer token",
      });
    }

    const validation = await this.resolvePayload(token, requestId);
    if (!validation.ok) {
      if (validation.code === "AUTH_UPSTREAM_UNAVAILABLE") {
        throw new ServiceUnavailableException({
          code: validation.code,
          message: validation.message,
        });
      }
      throw new UnauthorizedException({
        code: validation.code,
        message: validation.message,
      });
    }
    const payload = validation.payload;

    const userId = typeof payload.sub === "string" ? payload.sub : "";
    const sid = typeof payload.sid === "string" ? payload.sid : "";
    const email = typeof payload.email === "string" ? payload.email : undefined;
    const systemRole =
      typeof payload.systemRole === "string" ? payload.systemRole : undefined;

    if (!userId || !sid) {
      this.logAuthFailure({
        code: "AUTH_SESSION_INVALID",
        requestId,
        reason: "missing_required_claims",
      });
      throw new UnauthorizedException({
        code: "AUTH_SESSION_INVALID",
        message: "Token missing required claims",
      });
    }

    request.user = {
      userId,
      sid,
      email,
      systemRole,
    };
    return true;
  }

  private async resolvePayload(
    token: string,
    requestId: string,
  ): Promise<AuthValidationResult> {
    const localValidation = await this.verifyTokenLocally(token, requestId);
    if (!localValidation.ok) {
      return localValidation;
    }

    const tokenCacheKey = this.createTokenCacheKey(token);
    const now = Date.now();
    const cachedPayload = this.getFreshCachedPayload(tokenCacheKey, now);
    if (cachedPayload) {
      return {
        ok: true,
        payload: cachedPayload,
      };
    }

    return this.resolvePayloadViaAuthService({
      token,
      requestId,
      tokenCacheKey,
      localPayload: localValidation.payload,
      now,
    });
  }

  private extractBearerToken(request: Request): string | null {
    const value = request.headers.authorization;
    if (!value || !value.toLowerCase().startsWith("bearer ")) {
      const tokenFromQuery =
        typeof request.query?.token === "string"
          ? request.query.token.trim()
          : "";
      if (tokenFromQuery) {
        return tokenFromQuery;
      }
      return null;
    }
    return value.slice(7).trim() || null;
  }

  private async resolvePayloadViaAuthService(input: {
    token: string;
    requestId: string;
    tokenCacheKey: string;
    localPayload: AuthPayload;
    now: number;
  }): Promise<AuthValidationResult> {
    const existingValidation = this.authValidationInFlight.get(
      input.tokenCacheKey,
    );
    if (existingValidation) {
      return existingValidation;
    }

    const validationPromise = this.performAuthServiceValidation(input).finally(
      () => {
        this.authValidationInFlight.delete(input.tokenCacheKey);
      },
    );
    this.authValidationInFlight.set(input.tokenCacheKey, validationPromise);
    return validationPromise;
  }

  private async performAuthServiceValidation(input: {
    token: string;
    requestId: string;
    tokenCacheKey: string;
    localPayload: AuthPayload;
    now: number;
  }): Promise<AuthValidationResult> {
    const { token, requestId, tokenCacheKey, localPayload, now } = input;

    if (!this.internalProxySecret || !this.authServiceBaseUrl) {
      const stalePayload = this.getStaleCachedPayload(tokenCacheKey, now);
      if (stalePayload) {
        return {
          ok: true,
          payload: stalePayload,
        };
      }

      this.logAuthFailure({
        code: "AUTH_UPSTREAM_UNAVAILABLE",
        requestId,
        reason: "auth_guard_misconfigured_fallback_local_payload",
      });
      this.setCachedPayload(tokenCacheKey, localPayload, now);
      return {
        ok: true,
        payload: localPayload,
      };
    }

    try {
      const response = await fetch(`${this.authServiceBaseUrl}/me`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "x-proxy-secret": this.internalProxySecret,
        },
      });

      if (!response.ok) {
        const upstreamCode = await this.extractUpstreamErrorCode(response);
        const upstreamStatus = Number(response.status || 0);
        const isSessionFailure =
          upstreamStatus === 401 || upstreamStatus === 403;
        const code = isSessionFailure
          ? "AUTH_SESSION_INVALID"
          : "AUTH_UPSTREAM_UNAVAILABLE";

        if (isSessionFailure) {
          this.authValidationCache.delete(tokenCacheKey);
        } else {
          const stalePayload = this.getStaleCachedPayload(tokenCacheKey, now);
          if (stalePayload) {
            this.logAuthFailure({
              code: "AUTH_UPSTREAM_UNAVAILABLE",
              requestId,
              reason: this.isTransientUpstreamFailure(upstreamStatus)
                ? "auth_me_transient_fallback_stale_cache"
                : "auth_me_non_session_failure_fallback_stale_cache",
              upstreamStatus,
              upstreamCode,
            });
            return {
              ok: true,
              payload: stalePayload,
            };
          }

          this.logAuthFailure({
            code: "AUTH_UPSTREAM_UNAVAILABLE",
            requestId,
            reason: this.isTransientUpstreamFailure(upstreamStatus)
              ? "auth_me_transient_fallback_local_payload"
              : "auth_me_non_session_failure_fallback_local_payload",
            upstreamStatus,
            upstreamCode,
          });
          this.setCachedPayload(tokenCacheKey, localPayload, now);
          return {
            ok: true,
            payload: localPayload,
          };
        }

        this.logAuthFailure({
          code,
          requestId,
          reason: isSessionFailure
            ? "auth_me_rejected_token"
            : "auth_me_unavailable",
          upstreamStatus,
          upstreamCode,
        });
        return {
          ok: false,
          code,
          message: isSessionFailure
            ? "Invalid access token (auth-me validation failed)"
            : "Authentication upstream unavailable",
        };
      }

      const body = (await response.json()) as {
        user?: { id?: unknown; email?: unknown; systemRole?: unknown };
      };
      const userId =
        body &&
        typeof body === "object" &&
        body.user &&
        typeof body.user.id === "string"
          ? body.user.id.trim()
          : localPayload.sub;

      if (!userId || userId !== localPayload.sub) {
        this.logAuthFailure({
          code: "AUTH_SESSION_INVALID",
          requestId,
          reason: "auth_me_invalid_user_payload",
          upstreamStatus: 200,
        });
        this.authValidationCache.delete(tokenCacheKey);
        return {
          ok: false,
          code: "AUTH_SESSION_INVALID",
          message: "Invalid access token (auth-me payload invalid)",
        };
      }

      const email =
        body.user && typeof body.user.email === "string"
          ? body.user.email
          : localPayload.email;
      const systemRole =
        body.user && typeof body.user.systemRole === "string"
          ? body.user.systemRole
          : localPayload.systemRole;

      const payload: AuthPayload = {
        sub: userId,
        sid: localPayload.sid,
        email,
        systemRole,
        exp: localPayload.exp,
      };
      this.setCachedPayload(tokenCacheKey, payload, now);

      return {
        ok: true,
        payload,
      };
    } catch (error) {
      const stalePayload = this.getStaleCachedPayload(tokenCacheKey, now);
      if (stalePayload) {
        this.logAuthFailure({
          code: "AUTH_UPSTREAM_UNAVAILABLE",
          requestId,
          reason: "auth_me_request_failed_fallback_stale_cache",
          error,
        });
        return {
          ok: true,
          payload: stalePayload,
        };
      }

      this.logAuthFailure({
        code: "AUTH_UPSTREAM_UNAVAILABLE",
        requestId,
        reason: "auth_me_request_failed_fallback_local_payload",
        error,
      });
      this.setCachedPayload(tokenCacheKey, localPayload, now);
      return {
        ok: true,
        payload: localPayload,
      };
    }
  }

  private async verifyTokenLocally(
    token: string,
    requestId: string,
  ): Promise<AuthValidationResult> {
    try {
      const tokenPayload = await this.jwksService.verifyAccessToken(token);
      const sub =
        typeof tokenPayload.sub === "string" ? tokenPayload.sub.trim() : "";
      const sid =
        typeof tokenPayload.sid === "string" ? tokenPayload.sid.trim() : "";
      const email =
        typeof tokenPayload.email === "string"
          ? tokenPayload.email.trim()
          : undefined;
      const systemRole =
        typeof tokenPayload.systemRole === "string"
          ? tokenPayload.systemRole.trim()
          : undefined;
      const exp =
        typeof tokenPayload.exp === "number" && Number.isFinite(tokenPayload.exp)
          ? tokenPayload.exp
          : undefined;

      if (!sub || !sid) {
        this.logAuthFailure({
          code: "AUTH_SESSION_INVALID",
          requestId,
          reason: "token_missing_required_claims",
        });
        return {
          ok: false,
          code: "AUTH_SESSION_INVALID",
          message: "Token missing required claims",
        };
      }

      return {
        ok: true,
        payload: {
          sub,
          sid,
          email,
          systemRole,
          exp,
        },
      };
    } catch (error) {
      this.logAuthFailure({
        code: "AUTH_SESSION_INVALID",
        requestId,
        reason: "token_signature_validation_failed",
        error,
      });
      return {
        ok: false,
        code: "AUTH_SESSION_INVALID",
        message: "Invalid access token",
      };
    }
  }

  private async extractUpstreamErrorCode(
    response: globalThis.Response,
  ): Promise<string> {
    try {
      const body = (await response.json()) as { code?: unknown };
      return typeof body.code === "string" ? body.code.trim() : "";
    } catch {
      return "";
    }
  }

  private logAuthFailure(input: {
    code:
      | "AUTH_TOKEN_MISSING"
      | "AUTH_SESSION_INVALID"
      | "AUTH_UPSTREAM_UNAVAILABLE";
    requestId: string;
    reason: string;
    upstreamStatus?: number;
    upstreamCode?: string;
    error?: unknown;
  }): void {
    const { code, requestId, reason, upstreamStatus, upstreamCode, error } =
      input;
    const details = [
      `code=${code}`,
      `reason=${reason}`,
      `request_id=${requestId}`,
      `auth_service_base_url=${this.authServiceBaseUrl || "n/a"}`,
      upstreamStatus ? `auth_me_status=${upstreamStatus}` : "",
      upstreamCode ? `auth_me_code=${upstreamCode}` : "",
    ]
      .filter((part) => part.length > 0)
      .join(" ");

    if (error instanceof Error) {
      this.logger.warn(`${details} error="${error.message}"`);
      return;
    }

    this.logger.warn(details);
  }

  private createTokenCacheKey(token: string): string {
    return createHash("sha256")
      .update(token)
      .digest("hex")
      .slice(0, 48);
  }

  private setCachedPayload(
    tokenCacheKey: string,
    payload: AuthPayload,
    now: number,
  ): void {
    const ttlMs = this.resolveCacheTtlMs(payload, now);
    if (ttlMs <= 0) {
      return;
    }

    const expiresAt = now + ttlMs;
    const staleUntil = expiresAt + this.authMeStaleGraceMs;
    this.authValidationCache.set(tokenCacheKey, {
      payload,
      expiresAt,
      staleUntil,
    });
    this.pruneCache(now);
  }

  private getFreshCachedPayload(
    tokenCacheKey: string,
    now: number,
  ): AuthPayload | null {
    const entry = this.authValidationCache.get(tokenCacheKey);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt > now) {
      return entry.payload;
    }
    if (entry.staleUntil <= now) {
      this.authValidationCache.delete(tokenCacheKey);
    }
    return null;
  }

  private getStaleCachedPayload(
    tokenCacheKey: string,
    now: number,
  ): AuthPayload | null {
    const entry = this.authValidationCache.get(tokenCacheKey);
    if (!entry) {
      return null;
    }
    if (entry.staleUntil <= now) {
      this.authValidationCache.delete(tokenCacheKey);
      return null;
    }
    return entry.payload;
  }

  private resolveCacheTtlMs(payload: AuthPayload, now: number): number {
    let ttlMs = this.authMeCacheTtlMs;
    if (typeof payload.exp === "number" && Number.isFinite(payload.exp)) {
      const timeUntilExpiry = payload.exp * 1000 - now - 1_000;
      ttlMs = Math.min(ttlMs, timeUntilExpiry);
    }
    return Math.max(0, Math.floor(ttlMs));
  }

  private pruneCache(now: number): void {
    this.authValidationCache.forEach((entry, key) => {
      if (entry.staleUntil <= now) {
        this.authValidationCache.delete(key);
      }
    });

    while (
      this.authValidationCache.size > MAX_AUTH_VALIDATION_CACHE_ENTRIES
    ) {
      const oldestKey = this.authValidationCache.keys().next().value as
        | string
        | undefined;
      if (!oldestKey) {
        break;
      }
      this.authValidationCache.delete(oldestKey);
    }
  }

  private isTransientUpstreamFailure(status: number): boolean {
    return status === 429 || (status >= 500 && status <= 599);
  }

  private readDurationMs(envKey: string, fallbackMs: number): number {
    const raw = this.configService.get<string>(envKey);
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      return fallbackMs;
    }
    return Math.floor(value);
  }
}
