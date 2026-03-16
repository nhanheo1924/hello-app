import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";
import { JwksService } from "./jwks.service";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwksService: JwksService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "Missing bearer token",
      });
    }

    let payload: Awaited<ReturnType<JwksService["verifyAccessToken"]>>;
    try {
      payload = await this.jwksService.verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "Invalid access token",
      });
    }

    const userId = typeof payload.sub === "string" ? payload.sub : "";
    const sid = typeof payload.sid === "string" ? payload.sid : "";
    const email = typeof payload.email === "string" ? payload.email : undefined;

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
    };
    return true;
  }

  private extractBearerToken(request: Request): string | null {
    const value = request.headers.authorization;
    if (!value || !value.toLowerCase().startsWith("bearer ")) {
      return null;
    }
    return value.slice(7).trim() || null;
  }
}
