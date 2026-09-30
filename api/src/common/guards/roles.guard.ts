import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role, ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedRequest } from '../interfaces/jwt-payload.interface';

/**
 * Se ejecuta después de JwtAuthGuard, que ya dejó `request.user` poblado
 * (o rechazó la petición). Las rutas con @Roles('admin') exigen, además del
 * rol, que la sesión tenga el claim `mfa: true` (2FA obligatorio para
 * admins, sección 1 y 4.3 de CLAUDE.md).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user || !requiredRoles.includes(user.rol)) {
      throw new ForbiddenException(
        'No tienes permisos para acceder a este recurso',
      );
    }

    if (requiredRoles.includes('admin') && !user.mfa) {
      throw new ForbiddenException('Se requiere una sesión con 2FA completado');
    }

    return true;
  }
}
