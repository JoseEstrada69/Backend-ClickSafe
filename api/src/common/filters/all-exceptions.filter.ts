import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';

interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string | string[];
  requestId: string;
}

/**
 * Filtro global (4.5): la respuesta NUNCA incluye stack traces ni mensajes
 * crudos de MySQL/TypeORM. Los errores 500 devuelven un mensaje genérico;
 * el detalle completo solo va al log, correlacionado por requestId.
 */
@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(AllExceptionsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    // pino-http declara request.id como ReqId (string | number | object).
    // Solo lo normalizamos con String() cuando es string/number: un objeto
    // se volvería "[object Object]" y perdería la información sin avisar.
    const requestId =
      typeof request.id === 'string' || typeof request.id === 'number'
        ? String(request.id)
        : 'unknown';

    const { status, error, message, logDetail } = this.resolve(exception);

    // 500 en vez de HttpStatus.INTERNAL_SERVER_ERROR: comparar un `number`
    // contra ese enum dispara @typescript-eslint/no-unsafe-enum-comparison,
    // y el cast necesario para evitarlo lo retira no-unnecessary-type-assertion.
    if (status >= 500) {
      this.logger.error({ err: exception, requestId }, logDetail);
    } else {
      this.logger.warn({ requestId }, logDetail);
    }

    const body: ErrorResponseBody = {
      statusCode: status,
      error,
      message,
      requestId,
    };
    response.status(status).json(body);
  }

  private resolve(exception: unknown): {
    status: number;
    error: string;
    message: string | string[];
    logDetail: string;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const message = this.extractMessage(
        exception.getResponse(),
        exception.message,
      );
      return {
        status,
        error: STATUS_CODES[status] ?? 'Error',
        message,
        logDetail: exception.message,
      };
    }

    // Excepción no controlada (p. ej. un error de infraestructura): nunca
    // se expone su mensaje real al cliente, solo al log.
    const logDetail =
      exception instanceof Error ? exception.message : 'Error desconocido';
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error:
        STATUS_CODES[HttpStatus.INTERNAL_SERVER_ERROR] ??
        'Internal Server Error',
      message: 'Ocurrió un error inesperado.',
      logDetail,
    };
  }

  private extractMessage(
    responseBody: unknown,
    fallback: string,
  ): string | string[] {
    if (
      typeof responseBody === 'object' &&
      responseBody !== null &&
      'message' in responseBody
    ) {
      const message = responseBody.message;
      if (typeof message === 'string' || Array.isArray(message)) {
        return message;
      }
    }
    return fallback;
  }
}
