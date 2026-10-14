import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import type { ErrorCode } from '../errors/error-code.type';

/**
 * Ejemplo de cuerpo de error, con el mismo formato que produce
 * AllExceptionsFilter (4.5): { statusCode, error, message, requestId } y,
 * cuando aplica, `code` (lista cerrada, sección 7).
 */
function errorExample(
  status: number,
  error: string,
  message: string,
  code?: ErrorCode,
) {
  return {
    statusCode: status,
    error,
    message,
    requestId: '5b1e2c2a-1234-4a5b-8c9d-0e1f2a3b4c5d',
    ...(code ? { code } : {}),
  };
}

/** 400 — error de validación o de negocio (captcha, código, contraseña débil, etc.). */
export function ApiBadRequestResponse(description: string, code?: ErrorCode) {
  return applyDecorators(
    ApiResponse({
      status: 400,
      description,
      schema: { example: errorExample(400, 'Bad Request', description, code) },
    }),
  );
}

/** 401 — token/credenciales/código inválidos o expirados. */
export function ApiUnauthorizedResponse(
  description = 'Credenciales inválidas, o token/código inválido o expirado.',
) {
  return applyDecorators(
    ApiResponse({
      status: 401,
      description,
      schema: { example: errorExample(401, 'Unauthorized', description) },
    }),
  );
}

/** 403 — autenticado pero sin permiso para esta acción. */
export function ApiForbiddenResponse(description: string, code?: ErrorCode) {
  return applyDecorators(
    ApiResponse({
      status: 403,
      description,
      schema: { example: errorExample(403, 'Forbidden', description, code) },
    }),
  );
}

/** 409 — conflicto con el estado actual del recurso (duplicado, ya resuelto/moderado, etc.). */
export function ApiConflictResponse(description: string, code?: ErrorCode) {
  return applyDecorators(
    ApiResponse({
      status: 409,
      description,
      schema: { example: errorExample(409, 'Conflict', description, code) },
    }),
  );
}

/** 429 — límite de peticiones excedido (4.4). */
export function ApiTooManyRequestsResponse() {
  return applyDecorators(
    ApiResponse({
      status: 429,
      description: 'Se excedió el límite de peticiones para esta ruta.',
      schema: {
        example: errorExample(
          429,
          'Too Many Requests',
          'ThrottlerException: Too Many Requests',
        ),
      },
    }),
  );
}
