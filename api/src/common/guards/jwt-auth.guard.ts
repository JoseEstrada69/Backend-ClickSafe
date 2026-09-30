import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AppConfigService } from '../../config/app-config.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type {
  AuthenticatedRequest,
  JwtAccessPayload,
} from '../interfaces/jwt-payload.interface';

/**
 * Guard global (deny-by-default, 4.3): toda ruta exige un access token
 * válido salvo que esté marcada con @Public(). Verifica firma, expiración,
 * algoritmo (fijado a HS256 para evitar confusión de algoritmo / alg:none),
 * issuer y audience.
 *
 * Pendiente para cuando exista el módulo de BD (Fase 2/3): verificar que la
 * sesión (payload.sid) no esté revocada y que el usuario siga activo, para
 * que un logout o una suspensión surtan efecto antes de que expire el token.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly appConfig: AppConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Token requerido');
    }

    const { jwt } = this.appConfig;

    try {
      const payload = await this.jwtService.verifyAsync<JwtAccessPayload>(
        token,
        {
          secret: jwt.accessSecret,
          algorithms: ['HS256'],
          issuer: jwt.issuer,
          audience: jwt.audience,
        },
      );
      request.user = payload;
      return true;
    } catch {
      // Mensaje genérico: no distingue expirado / firma inválida / malformado.
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }

  private extractToken(request: AuthenticatedRequest): string | undefined {
    const header = request.headers.authorization;
    if (!header) {
      return undefined;
    }
    const [scheme, token] = header.split(' ');
    return scheme === 'Bearer' && token ? token : undefined;
  }
}
