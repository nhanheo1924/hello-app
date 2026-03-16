import { Logger, RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  const configService = app.get(ConfigService);

  const port = configService.get<number>('APP_PORT', 3000);
  const host = configService.get<string>('APP_HOST', '0.0.0.0');
  const prefix = configService.get<string>('APP_PREFIX', 'api');
  const corsOrigin = configService.get<string>('CORS_ORIGIN', '');
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');
  const corsOrigins = corsOrigin
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

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
  app.setGlobalPrefix(prefix, {
    exclude: [{ path: '.well-known/jwks.json', method: RequestMethod.GET }],
  });
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
      const normalizedAllowedOrigins = corsOrigins.map((allowedOrigin) =>
        allowedOrigin.trim().replace(/\/+$/, ''),
      );

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

  await app.listen(port, host);
  Logger.log(
    `API running at http://${host}:${port}/${prefix}`,
    'ApplicationBootstrap',
  );
}

void bootstrap();
