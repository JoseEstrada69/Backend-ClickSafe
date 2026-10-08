import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfigService } from '../../config/app-config.service';
import { Sesion, Usuario } from '../../database/entities';
import { extractBearerToken } from '../../common/utils/extract-bearer-token';
import { isSessionValid } from '../../common/utils/is-session-valid';
import type { JwtAccessPayload } from '../../common/interfaces/jwt-payload.interface';
import type { MfaAuthenticatedRequest } from '../interfaces/mfa-authenticated-request.interface';
import type { MfaTokenPayload } from '../interfaces/mfa-token-payload.interface';

interface VerifyOptions {
  algorithms: ['HS256'];
  issuer: string;
  audience: string;
}

/**
 * Guard de /auth/2fa/setup y /auth/2fa/enable (5.5). Acepta EXACTAMENTE dos
 * tipos de token, cada uno verificado con su propio secreto — nunca se
 * pueden intercambiar porque un mfaToken no valida con JWT_ACCESS_SECRET ni
 * viceversa, y porque cada rama exige además su propio claim distintivo:
 *   1. mfaToken (typ: 'mfa', firmado con JWT_MFA_SECRET, 5 min): el que se
 *      emite en el primer login de un admin, antes de tener sesión.
 *   2. El access token de una sesión admin YA completada (rol: 'admin',
 *      firmado con JWT_ACCESS_SECRET, sesión no revocada y usuario activo):
 *      para reconfigurar 2FA más adelante (p. ej. si perdió el celular).
 * Deja al admin ya resuelto en request.mfaAdmin — el controlador nunca lee
 * el header Authorization directamente.
 */
@Injectable()
export class MfaOrAdminSessionGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly appConfig: AppConfigService,
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
    @InjectRepository(Sesion)
    private readonly sesionRepo: Repository<Sesion>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<MfaAuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('Token requerido');
    }

    const { jwt } = this.appConfig;
    const verifyOptions: VerifyOptions = {
      algorithms: ['HS256'],
      issuer: jwt.issuer,
      audience: jwt.audience,
    };

    const admin =
      (await this.tryMfaToken(token, jwt.mfaSecret, verifyOptions)) ??
      (await this.tryAdminAccessToken(token, jwt.accessSecret, verifyOptions));

    if (!admin) {
      throw new UnauthorizedException('Token inválido o expirado');
    }

    request.mfaAdmin = admin;
    return true;
  }

  private async tryMfaToken(
    token: string,
    secret: string,
    verifyOptions: VerifyOptions,
  ): Promise<Usuario | null> {
    try {
      const payload = await this.jwtService.verifyAsync<MfaTokenPayload>(
        token,
        { secret, ...verifyOptions },
      );
      if (payload.typ !== 'mfa') {
        return null;
      }
      return await this.usuarioRepo.findOne({
        where: { idUsuario: payload.sub, rol: 'admin' },
      });
    } catch {
      return null;
    }
  }

  private async tryAdminAccessToken(
    token: string,
    secret: string,
    verifyOptions: VerifyOptions,
  ): Promise<Usuario | null> {
    try {
      const payload = await this.jwtService.verifyAsync<JwtAccessPayload>(
        token,
        { secret, ...verifyOptions },
      );
      if (
        payload.rol !== 'admin' ||
        !(await isSessionValid(this.sesionRepo, payload.sid))
      ) {
        return null;
      }
      return await this.usuarioRepo.findOne({
        where: { idUsuario: payload.sub, rol: 'admin' },
      });
    } catch {
      return null;
    }
  }
}
