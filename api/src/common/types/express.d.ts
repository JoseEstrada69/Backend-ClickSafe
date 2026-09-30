import 'express-serve-static-core';

// Este es el módulo donde @types/express define Request realmente;
// pino-http, por su parte, amplía http.IncomingMessage.id como ReqId
// (string | number). Al declarar `id: string` aquí (más específico),
// sigue siendo asignable donde se espera ReqId.
declare module 'express-serve-static-core' {
  interface Request {
    /** UUID único por petición, asignado por requestIdMiddleware. */
    id: string;
  }
}
