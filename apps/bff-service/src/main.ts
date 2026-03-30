import {
  Logger,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { WebSocketServer } from 'ws';
import type WebSocket from 'ws';
import { AppModule } from './app.module';
import { SyncService } from './sync/sync.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  const configService = app.get(ConfigService);

  const port = configService.get<number>('APP_PORT', 3001);
  const host = configService.get<string>('APP_HOST', '0.0.0.0');
  const prefix = configService.get<string>('APP_PREFIX', 'api/v1');
  const corsOrigin = configService.get<string>('CORS_ORIGIN', '');
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');
  const corsOrigins = corsOrigin
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  const normalizedAllowedOrigins = corsOrigins.map((allowedOrigin) =>
    allowedOrigin.trim().replace(/\/+$/, ''),
  );

  app.use((req: Request, res: Response, next: NextFunction) => {
    const incomingRequestId = req.header('x-request-id');
    const requestId =
      incomingRequestId && incomingRequestId.length > 0
        ? incomingRequestId
        : randomUUID();

    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    next();
  });

  app.set('trust proxy', 1);
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

      const normalizedOrigin = origin.trim().replace(/\/+$/, '');

      if (normalizedAllowedOrigins.includes(normalizedOrigin)) {
        callback(null, true);
        return;
      }

      const isLocalDevOrigin =
        nodeEnv !== 'production' &&
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalizedOrigin);
      if (isLocalDevOrigin) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    credentials: true,
  });

  const syncService = app.get(SyncService);
  const httpServer = app.getHttpServer() as import('http').Server;
  const wsServer = new WebSocketServer({ noServer: true });
  const normalizedPrefix = String(prefix || '').replace(/^\/+|\/+$/g, '');
  const syncWsPath = normalizedPrefix ? `/${normalizedPrefix}/sync/ws` : '/sync/ws';

  httpServer.on('upgrade', (request, socket, head) => {
    const requestUrl = new URL(request.url || '/', 'http://localhost');
    if (requestUrl.pathname !== syncWsPath) {
      socket.destroy();
      return;
    }

    const originHeader =
      typeof request.headers.origin === 'string' ? request.headers.origin : '';
    const normalizedOrigin = originHeader.trim().replace(/\/+$/, '');
    const isExplicitlyAllowedOrigin =
      normalizedOrigin.length > 0 &&
      normalizedAllowedOrigins.includes(normalizedOrigin);
    const isLocalDevOrigin =
      normalizedOrigin.length > 0 &&
      nodeEnv !== 'production' &&
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalizedOrigin);
    const hasOrigin = normalizedOrigin.length > 0;
    if (hasOrigin && !isExplicitlyAllowedOrigin && !isLocalDevOrigin) {
      socket.destroy();
      return;
    }

    wsServer.handleUpgrade(request, socket, head, (websocket: WebSocket) => {
      syncService.openWebSocket(request, websocket, {
        workspaceId: requestUrl.searchParams.get('workspaceId') || undefined,
        token: requestUrl.searchParams.get('token') || undefined,
        scope: requestUrl.searchParams.get('scope') || undefined,
      });
    });
  });

  await app.listen(port, host);
  Logger.log(
    `BFF running at http://${host}:${port}/${prefix}`,
    'ApplicationBootstrap',
  );
}

void bootstrap();
