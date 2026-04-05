import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

interface ErrorEnvelope {
  error: string;
  code?: string;
  message?: string;
  details?: unknown;
}

const STATUS_CODE_MAP: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
};
const TOO_MANY_REQUESTS_STATUS = 429;

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();

    const status = this.resolveStatus(exception);
    const body = this.resolveBody(exception, status);
    const retryAfterSeconds = this.resolveRetryAfterSeconds(exception, status);

    if (!(exception instanceof HttpException)) {
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    if (retryAfterSeconds > 0) {
      response.setHeader('Retry-After', String(retryAfterSeconds));
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
      if (typeof response === 'string') {
        return this.toErrorEnvelope(
          response,
          this.defaultCodeForStatus(status),
        );
      }

      if (response && typeof response === 'object') {
        const raw = response as {
          code?: unknown;
          message?: unknown;
          details?: unknown;
        };
        const hasValidationDetails =
          Array.isArray(raw.message) && raw.message.length > 0;

        if (typeof raw.code === 'string' && typeof raw.message === 'string') {
          return raw.details === undefined
            ? this.toErrorEnvelope(raw.message, raw.code)
            : this.toErrorEnvelope(raw.message, raw.code, raw.details);
        }

        if (hasValidationDetails) {
          return this.toErrorEnvelope(
            'Validation failed',
            'VALIDATION_ERROR',
            raw.message,
          );
        }

        if (typeof raw.message === 'string') {
          return this.toErrorEnvelope(
            raw.message,
            this.defaultCodeForStatus(status),
          );
        }
      }
    }

    return this.toErrorEnvelope('Internal server error', 'INTERNAL_ERROR');
  }

  private defaultCodeForStatus(status: number): string {
    return STATUS_CODE_MAP[status] ?? 'INTERNAL_ERROR';
  }

  private toErrorEnvelope(
    message: string,
    code: string,
    details?: unknown,
  ): ErrorEnvelope {
    return details === undefined
      ? {
          error: message,
          message,
          code,
        }
      : {
          error: message,
          message,
          code,
          details,
        };
  }

  private resolveRetryAfterSeconds(exception: unknown, status: number): number {
    if (status !== TOO_MANY_REQUESTS_STATUS) {
      return 0;
    }

    if (!(exception instanceof HttpException)) {
      return 0;
    }

    const rawResponse = exception.getResponse();
    if (!rawResponse || typeof rawResponse !== 'object') {
      return 0;
    }

    const record = rawResponse as {
      retryAfterSeconds?: unknown;
      details?: {
        retryAfterSeconds?: unknown;
      };
    };
    const direct = Number(record.retryAfterSeconds);
    if (Number.isFinite(direct) && direct > 0) {
      return Math.floor(direct);
    }

    const nested = Number(record.details?.retryAfterSeconds);
    if (Number.isFinite(nested) && nested > 0) {
      return Math.floor(nested);
    }

    return 0;
  }
}
