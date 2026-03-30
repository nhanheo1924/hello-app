import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  const configService = app.get(ConfigService);

  const port = configService.get<number>("APP_PORT", 3102);
  const host = configService.get<string>("APP_HOST", "0.0.0.0");
  const prefix = configService.get<string>("APP_PREFIX", "api");
  const corsOrigin = configService.get<string>("CORS_ORIGIN", "");
  const corsOrigins = corsOrigin
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

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
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    credentials: true,
  });

  await app.listen(port, host);
  Logger.log(
    `Task API running at http://${host}:${port}/${prefix}`,
    "ApplicationBootstrap",
  );
}

void bootstrap();
