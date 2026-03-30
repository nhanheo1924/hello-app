import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "crypto";
import { Request } from "express";

@Injectable()
export class ProxySecretGuard implements CanActivate {
  private static readonly publicPaths = new Set([
    "/health",
    "/api/health",
    "/health/ready",
    "/api/health/ready",
  ]);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (this.isPublicPath(request.path)) {
      return true;
    }

    const expectedSecret = this.configService.get<string>(
      "INTERNAL_PROXY_SECRET",
    );
    const providedSecret = this.getSingleHeaderValue(
      request.headers["x-proxy-secret"],
    );

    // Reject direct traffic to backend; only trusted proxy may pass.
    if (
      !expectedSecret ||
      !providedSecret ||
      !this.isSecretMatch(expectedSecret, providedSecret)
    ) {
      throw new UnauthorizedException("Proxy only");
    }

    return true;
  }

  private isPublicPath(path: string | undefined): boolean {
    if (!path) {
      return false;
    }
    return ProxySecretGuard.publicPaths.has(path);
  }

  private getSingleHeaderValue(
    value: string | string[] | undefined,
  ): string | undefined {
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  }

  private isSecretMatch(expected: string, provided: string): boolean {
    const expectedBuffer = Buffer.from(expected);
    const providedBuffer = Buffer.from(provided);

    if (expectedBuffer.length !== providedBuffer.length) {
      return false;
    }

    return timingSafeEqual(expectedBuffer, providedBuffer);
  }
}
