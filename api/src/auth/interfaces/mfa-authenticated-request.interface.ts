import type { Request } from 'express';
import type { Usuario } from '../../database/entities';

/** Puebla MfaOrAdminSessionGuard: el admin ya resuelto, para no volver a decodificar el token en el controlador. */
export interface MfaAuthenticatedRequest extends Request {
  mfaAdmin?: Usuario;
}
