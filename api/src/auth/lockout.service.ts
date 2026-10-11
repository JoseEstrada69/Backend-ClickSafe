import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Usuario } from '../database/entities';

const FAILURES_PER_CYCLE = 5;
const BASE_LOCKOUT_MINUTES = 15;
const MAX_LOCKOUT_MINUTES = 24 * 60;

/**
 * Bloqueo progresivo (5.4/5.5): cada 5 fallos consecutivos duplica el
 * tiempo del bloqueo anterior (15 min, 30, 60... hasta 24 h). No existe
 * una columna de "nivel de bloqueo" en Usuario (no se altera el esquema):
 * el ciclo se deriva de intentos_fallidos / 5, que solo se reinicia en un
 * login exitoso o un restablecimiento de contraseña.
 */
@Injectable()
export class LockoutService {
  constructor(
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
  ) {}

  isLocked(usuario: Pick<Usuario, 'bloqueadoHasta'>): boolean {
    return (
      !!usuario.bloqueadoHasta && usuario.bloqueadoHasta.getTime() > Date.now()
    );
  }

  /**
   * Registra un fallo (contraseña o código 2FA incorrectos). Si ya está
   * bloqueado, no sigue incrementando (evita que un reintento automatizado
   * durante el bloqueo alargue artificialmente el próximo ciclo).
   */
  async registerFailedAttempt(usuario: Usuario): Promise<void> {
    if (this.isLocked(usuario)) {
      return;
    }

    const intentos = usuario.intentosFallidos + 1;
    const update: Partial<Usuario> = { intentosFallidos: intentos };

    if (intentos % FAILURES_PER_CYCLE === 0) {
      const cycle = intentos / FAILURES_PER_CYCLE;
      const minutes = Math.min(
        BASE_LOCKOUT_MINUTES * 2 ** (cycle - 1),
        MAX_LOCKOUT_MINUTES,
      );
      update.bloqueadoHasta = new Date(Date.now() + minutes * 60_000);
    }

    await this.usuarioRepo.update(usuario.idUsuario, update);
  }

  async resetLockout(idUsuario: number): Promise<void> {
    await this.usuarioRepo.update(idUsuario, {
      intentosFallidos: 0,
      bloqueadoHasta: null,
    });
  }
}
