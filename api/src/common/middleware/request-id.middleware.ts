import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Se registra con app.use() ANTES que cualquier otro middleware (incluido
 * pino-http), para que req.id exista cuando el logger y el filtro de
 * excepciones lo lean. Se expone como función simple (no NestMiddleware)
 * para que app.use() la aplique de forma síncrona e inmediata, sin depender
 * del orden en que Nest inicializa los middlewares declarados por módulos.
 */
export const requestIdMiddleware: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  req.id = randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
};
