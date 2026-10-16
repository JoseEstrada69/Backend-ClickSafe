import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { Repository } from 'typeorm';
import { BitacoraAuditoria, ResultadoAuditoria } from '../database/entities';
import { AuditAction } from './audit-action.type';

export interface AuditLogInput {
  idUsuario?: number | null;
  accion: AuditAction;
  resultado: ResultadoAuditoria;
  recursoTipo?: string | null;
  recursoId?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  /** NUNCA debe contener contraseñas, tokens, códigos ni secretos. */
  detalle?: Record<string, unknown> | null;
}

const RETRY_DELAY_MS = 75;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Escribe en Bitacora_auditoria (4.6). El usuario de BD de la API solo
 * tiene SELECT e INSERT en esa tabla: ni este servicio ni nadie más puede
 * borrar o alterar el rastro de auditoría, ni siquiera ante una inyección
 * SQL exitosa en otra parte del código.
 */
@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(BitacoraAuditoria)
    private readonly repository: Repository<BitacoraAuditoria>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AuditService.name);
  }

  /**
   * Un solo reintento tras una espera corta (75 ms): absorbe un bloqueo o
   * una conexión momentáneamente ocupada bajo carga concurrente alta (p. ej.
   * un escaneo activo contra varias rutas a la vez) sin perder el evento.
   * Si el segundo intento también falla, se registra en el log de la app
   * (con el `req.id` de la petición, propagado automáticamente por
   * nestjs-pino vía AsyncLocalStorage: ver docs/seguridad.md) pero nunca se
   * revela al cliente ni se interrumpe la operación original (4.6).
   */
  async log(input: AuditLogInput): Promise<void> {
    try {
      await this.insert(input);
      return;
    } catch {
      // primer intento fallido: se reintenta una vez abajo.
    }

    try {
      await wait(RETRY_DELAY_MS);
      await this.insert(input);
    } catch (error) {
      this.logger.error(
        { err: error, accion: input.accion, recursoTipo: input.recursoTipo },
        'No se pudo escribir en la bitácora de auditoría (tras reintentar)',
      );
    }
  }

  private async insert(input: AuditLogInput): Promise<void> {
    await this.repository.insert({
      idUsuario: input.idUsuario ?? null,
      accion: input.accion,
      resultado: input.resultado,
      recursoTipo: input.recursoTipo ?? null,
      recursoId: input.recursoId ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      // TypeORM no tipa bien QueryDeepPartialEntity para columnas JSON
      // genéricas (Record<string, unknown>); el valor es válido en runtime.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      detalle: (input.detalle ?? null) as any,
    });
  }
}
