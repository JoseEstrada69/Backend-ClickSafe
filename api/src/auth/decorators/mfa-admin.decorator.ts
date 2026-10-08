import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Usuario } from '../../database/entities';
import type { MfaAuthenticatedRequest } from '../interfaces/mfa-authenticated-request.interface';

/**
 * Admin ya resuelto y validado por MfaOrAdminSessionGuard (request.mfaAdmin).
 * Úsalo junto con @UseGuards(MfaOrAdminSessionGuard); si el guard no corrió,
 * request.mfaAdmin nunca existe y esto lanzaría más abajo al usarlo, lo que
 * en la práctica solo pasaría por un error de programación, no de un
 * cliente.
 */
export const MfaAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Usuario => {
    const request = ctx.switchToHttp().getRequest<MfaAuthenticatedRequest>();
    return request.mfaAdmin as Usuario;
  },
);
