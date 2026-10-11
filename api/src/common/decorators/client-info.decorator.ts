import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestMeta } from '../interfaces/request-meta.interface';
import { normalizeIp } from '../utils/normalize-ip';

/**
 * Columnas Sesion.user_agent y Bitacora_auditoria.user_agent son
 * VARCHAR(255) (database/clicksafe_db.sql). El User-Agent lo controla el
 * cliente libremente — nada impide que mande un valor de miles de
 * caracteres — así que se recorta aquí, en el único punto donde se lee,
 * antes de que llegue a cualquier INSERT/UPDATE. Sin este recorte, un
 * header largo provoca "Data too long for column" en MySQL y por lo tanto
 * un 500 en vez de guardarse truncado.
 */
const MAX_USER_AGENT_LENGTH = 255;

/**
 * Extrae ip/userAgent de la petición para pasarlos a los servicios.
 * A propósito NO se usa @Headers('user-agent') + @Ip(): @nestjs/swagger
 * documenta @Headers(nombre) como un parámetro de la petición y, al no
 * haber forma de marcarlo opcional desde ahí, lo muestra como
 * obligatorio en el doc de OpenAPI — un cliente real (la app, curl,
 * Postman) no siempre manda User-Agent, así que un endpoint que lo
 * exigiera literalmente rechazaría peticiones legítimas. Un parámetro
 * armado con createParamDecorator no es uno de los decoradores que
 * @nestjs/swagger reconoce, así que no aparece documentado — ninguna
 * petición se bloquea por esto a nivel de framework. Si el header no
 * viene, el valor es null, nunca un error.
 */
export const ClientInfo = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestMeta => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const rawUserAgent = request.headers['user-agent'];

    return {
      ip: normalizeIp(request.ip),
      userAgent:
        typeof rawUserAgent === 'string' && rawUserAgent.length > 0
          ? rawUserAgent.slice(0, MAX_USER_AGENT_LENGTH)
          : null,
    };
  },
);
