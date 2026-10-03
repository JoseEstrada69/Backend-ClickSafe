import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfigService } from '../../config/app-config.service';
import { Sesion } from '../../database/entities';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { extractBearerToken } from '../utils/extract-bearer-token';
import type {
  AuthenticatedRequest,
  JwtAccessPayload,
} from '../interfaces/jwt-payload.interface';

/**
 * Guard global (deny-by-default, 4.3): toda ruta exige un access token
 * válido salvo que esté marcada con @Public(). Verifica firma, expiración,
 * algoritmo (fijado a HS256 para evitar confusión de algoritmo / alg:none),
 * issuer y audience, y además que la sesión (payload.sid) no esté
 * revocada y que el usuario siga activo — así un logout o una suspensión
 * surten efecto de inmediato y no hasta que expire el token (4.3).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly appConfig: AppConfigService,
    @InjectRepository(Sesion)
    private readonly sesionRepo: Repository<Sesion>,
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
    const token = extractBearerToken(request.headers.authorization);
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

      if (!(await this.isSessionValid(payload))) {
        throw new UnauthorizedException('Token inválido o expirado');
      }

      request.user = payload;
      return true;
    } catch {
      // Mensaje genérico: no distingue expirado / firma inválida / sesión
      // revocada / usuario suspendido / malformado.
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }

  private async isSessionValid(payload: JwtAccessPayload): Promise<boolean> {
    const idSesion = Number(payload.sid);
    if (!Number.isInteger(idSesion)) {
      return false;
    }
    const sesion = await this.sesionRepo.findOne({
      where: { idSesion },
      relations: { usuario: true },
    });
    if (!sesion || sesion.revocadaEn) {
      return false;
    }
    return sesion.usuario.activo;
  }
}
