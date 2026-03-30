import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly authServiceBaseUrl: string;
  private readonly internalProxySecret: string;

  constructor(private readonly configService: ConfigService) {
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
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "Missing bearer token",
      });
    }

    const payload = await this.resolvePayloadViaAuthService(token);
    if (!payload) {
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "Invalid access token (auth-me validation failed)",
      });
    }

    const userId = typeof payload.sub === "string" ? payload.sub : "";
    const sid = typeof payload.sid === "string" ? payload.sid : "";
    const email = typeof payload.email === "string" ? payload.email : undefined;
    const systemRole =
      typeof payload.systemRole === "string" ? payload.systemRole : undefined;

    // Keep strictness for task-service access because auth-service issues sid.
    if (!userId || !sid) {
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
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

  private async resolvePayloadViaAuthService(
    token: string,
  ): Promise<{ sub: string; sid: string; email?: string; systemRole?: string } | null> {
    if (!this.internalProxySecret || !this.authServiceBaseUrl) {
      return null;
    }

    const tokenPayload = this.decodeTokenPayload(token);
    const sid = typeof tokenPayload?.sid === "string" ? tokenPayload.sid : "";
    if (!sid) {
      return null;
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
        return null;
      }

      const body = (await response.json()) as {
        user?: { id?: unknown; email?: unknown; systemRole?: unknown };
      };
      const userId =
        body &&
        typeof body === "object" &&
        body.user &&
        typeof body.user.id === "string"
          ? body.user.id
          : "";
      if (!userId) {
        return null;
      }

      const email =
        body.user && typeof body.user.email === "string"
          ? body.user.email
          : undefined;
      const systemRole =
        body.user && typeof body.user.systemRole === "string"
          ? body.user.systemRole
          : undefined;
      return {
        sub: userId,
        sid,
        email,
        systemRole,
      };
    } catch {
      return null;
    }
  }

  private decodeTokenPayload(token: string): { sid?: unknown } | null {
    const parts = token.split(".");
    if (parts.length < 2) {
      return null;
    }

    try {
      const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
      const raw = Buffer.from(padded, "base64").toString("utf8");
      return JSON.parse(raw) as { sid?: unknown };
    } catch {
      return null;
    }
  }
}
