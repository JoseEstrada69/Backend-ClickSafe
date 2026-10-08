import { Repository } from 'typeorm';
import { Sesion } from '../../database/entities';

/**
 * Sesión activa (4.3): existe, no está revocada, y el usuario sigue activo.
 * Así un logout o una suspensión surten efecto de inmediato, sin esperar a
 * que expire el token. Compartido por JwtAuthGuard y por cualquier otro
 * guard que acepte un access token (p. ej. MfaOrAdminSessionGuard), para
 * que ambos exijan exactamente la misma condición de sesión válida.
 */
export async function isSessionValid(
  sesionRepo: Repository<Sesion>,
  idSesionRaw: unknown,
): Promise<boolean> {
  const idSesion = Number(idSesionRaw);
  if (!Number.isInteger(idSesion)) {
    return false;
  }
  const sesion = await sesionRepo.findOne({
    where: { idSesion },
    relations: { usuario: true },
  });
  if (!sesion || sesion.revocadaEn) {
    return false;
  }
  return sesion.usuario.activo;
}
