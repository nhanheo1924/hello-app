import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import { WebSocketServer } from "ws";
import type WebSocket from "ws";
import { AppModule } from "./app.module";
import { SyncService } from "./sync/sync.service";

function normalizeOrigin(origin: string): string {
  return String(origin || "")
    .trim()
    .replace(/\/+$/, "");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toWildcardOriginRegex(pattern: string): RegExp | null {
  const normalizedPattern = normalizeOrigin(pattern);
  if (!normalizedPattern.includes("*")) {
    return null;
  }

  const source = escapeRegex(normalizedPattern).replace(/\\\*/g, "[^/]+");
  try {
    return new RegExp(`^${source}$`, "i");
  } catch {
    return null;
  }
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  const configService = app.get(ConfigService);

  const port = configService.get<number>("APP_PORT", 3001);
  const host = configService.get<string>("APP_HOST", "0.0.0.0");
  const prefix = configService.get<string>("APP_PREFIX", "api/v1");
  const corsOrigin = configService.get<string>("CORS_ORIGIN", "");
  const allowVercelPreviewOrigins = configService.get<boolean>(
    "CORS_ALLOW_VERCEL_PREVIEW",
    true,
  );
  const nodeEnv = configService.get<string>("NODE_ENV", "development");
  const corsOrigins = corsOrigin
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  const normalizedAllowedOrigins = corsOrigins.map((allowedOrigin) =>
    normalizeOrigin(allowedOrigin),
  );
  const explicitAllowedOrigins = normalizedAllowedOrigins.filter(
    (allowedOrigin) => !allowedOrigin.includes("*"),
  );
  const wildcardAllowedOrigins = normalizedAllowedOrigins
    .map((allowedOrigin) => toWildcardOriginRegex(allowedOrigin))
    .filter((regex): regex is RegExp => regex !== null);
  const vercelPreviewOriginRegex = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i;

  const isLocalDevOrigin = (normalizedOrigin: string): boolean =>
    nodeEnv !== "production" &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalizedOrigin);

  const isAllowedOrigin = (normalizedOrigin: string): boolean => {
    if (!normalizedOrigin) {
      return true;
    }

    if (explicitAllowedOrigins.includes(normalizedOrigin)) {
      return true;
    }

    if (
      wildcardAllowedOrigins.some((originRegex) =>
        originRegex.test(normalizedOrigin),
      )
    ) {
      return true;
    }

    if (
      allowVercelPreviewOrigins &&
      vercelPreviewOriginRegex.test(normalizedOrigin)
    ) {
      return true;
    }

    return isLocalDevOrigin(normalizedOrigin);
  };

  app.use((req: Request, res: Response, next: NextFunction) => {
    const incomingRequestId = req.header("x-request-id");
    const requestId =
      incomingRequestId && incomingRequestId.length > 0
        ? incomingRequestId
        : randomUUID();

    req.requestId = requestId;
    res.setHeader("x-request-id", requestId);
    next();
  });

  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cookieParser());
  app.setGlobalPrefix(prefix);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      const normalizedOrigin = normalizeOrigin(origin);

      if (isAllowedOrigin(normalizedOrigin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    credentials: true,
  });

  const syncService = app.get(SyncService);
  const httpServer = app.getHttpServer();
  const wsServer = new WebSocketServer({ noServer: true });
  const normalizedPrefix = String(prefix || "").replace(/^\/+|\/+$/g, "");
  const syncWsPath = normalizedPrefix
    ? `/${normalizedPrefix}/sync/ws`
    : "/sync/ws";

  httpServer.on("upgrade", (request, socket, head) => {
    const requestUrl = new URL(request.url || "/", "http://localhost");
    if (requestUrl.pathname !== syncWsPath) {
      socket.destroy();
      return;
    }

    const originHeader =
      typeof request.headers.origin === "string" ? request.headers.origin : "";
    const normalizedOrigin = normalizeOrigin(originHeader);
    const hasOrigin = normalizedOrigin.length > 0;
    if (hasOrigin && !isAllowedOrigin(normalizedOrigin)) {
      socket.destroy();
      return;
    }

    wsServer.handleUpgrade(request, socket, head, (websocket: WebSocket) => {
      syncService.openWebSocket(request, websocket, {
        workspaceId: requestUrl.searchParams.get("workspaceId") || undefined,
        token: requestUrl.searchParams.get("token") || undefined,
        scope: requestUrl.searchParams.get("scope") || undefined,
      });
    });
  });

  await app.listen(port, host);
  Logger.log(
    `BFF running at http://${host}:${port}/${prefix}`,
    "ApplicationBootstrap",
  );
}

void bootstrap();
