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

  async log(input: AuditLogInput): Promise<void> {
    try {
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
    } catch (error) {
      // Si falla escribir la bitácora, se registra en el log de la app pero
      // nunca se revela al cliente ni se interrumpe la operación original (4.6).
      this.logger.error(
        { err: error, accion: input.accion },
        'No se pudo escribir en la bitácora de auditoría',
      );
    }
  }
}
