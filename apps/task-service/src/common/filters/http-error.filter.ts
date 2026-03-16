import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Response } from "express";

interface ErrorEnvelope {
  code: string;
  message: string;
  details?: unknown;
}

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();

    const status = this.resolveStatus(exception);
    const body = this.resolveBody(exception, status);

    if (!(exception instanceof HttpException)) {
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json(body);
  }

  private resolveStatus(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private resolveBody(exception: unknown, status: number): ErrorEnvelope {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (typeof response === "string") {
        return {
          code: this.defaultCodeForStatus(status),
          message: response,
        };
      }

      if (response && typeof response === "object") {
        const raw = response as {
          code?: unknown;
          message?: unknown;
          details?: unknown;
        };

        if (typeof raw.code === "string" && typeof raw.message === "string") {
          return raw.details === undefined
            ? { code: raw.code, message: raw.message }
            : { code: raw.code, message: raw.message, details: raw.details };
        }

        if (Array.isArray(raw.message)) {
          return {
            code: "VALIDATION_ERROR",
            message: "Validation failed",
            details: raw.message,
          };
        }

        if (typeof raw.message === "string") {
          return {
            code: this.defaultCodeForStatus(status),
            message: raw.message,
          };
        }
      }
    }

    return {
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    };
  }

  private defaultCodeForStatus(status: number): string {
    switch (status) {
      case 400:
        return "BAD_REQUEST";
      case 401:
        return "UNAUTHORIZED";
      case 403:
        return "FORBIDDEN";
      case 404:
        return "NOT_FOUND";
      case 409:
        return "CONFLICT";
      case 429:
        return "RATE_LIMITED";
      default:
        return "INTERNAL_ERROR";
    }
  }
}
