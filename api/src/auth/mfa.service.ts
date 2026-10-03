import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as QRCode from 'qrcode';
import { Repository } from 'typeorm';
import { AppConfigService } from '../config/app-config.service';
import { Usuario } from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { extractBearerToken } from '../common/utils/extract-bearer-token';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import {
  MfaChallengeResponse,
  Setup2faResponse,
  TokensResponse,
} from './auth-responses.interface';
import { LockoutService } from './lockout.service';
import { RequestMeta, SessionService } from './session.service';
import { decryptTotpSecret, encryptTotpSecret } from './utils/totp-encryption';
import { generateTotpSecret, totpKeyUri, verifyTotpCode } from './utils/totp';

const MFA_TOKEN_TTL_SECONDS = 5 * 60; // 5.4/5.5

interface MfaTokenPayload {
  sub: number;
  typ: 'mfa';
}

/**
 * 2FA de admins (5.5). El secreto TOTP se guarda cifrado (AES-256-GCM) y
 * nunca en claro. `/2fa/setup` y `/2fa/enable` aceptan tanto el mfaToken
 * de configuración inicial (emitido en el primer login, sin 2FA aún
 * activo) como el access token de una sesión admin ya completada (para
 * reconfigurar 2FA más adelante) — por eso resolveAdminFromMfaOrSession
 * intenta ambos.
 */
@Injectable()
export class MfaService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly appConfig: AppConfigService,
    private readonly auditService: AuditService,
    private readonly lockoutService: LockoutService,
    private readonly sessionService: SessionService,
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
  ) {}

  async resolveAdminFromMfaOrSession(
    authorizationHeader?: string,
  ): Promise<Usuario> {
    const token = extractBearerToken(authorizationHeader);
    if (!token) {
      throw new UnauthorizedException('Token requerido');
    }

    const { jwt } = this.appConfig;
    const verifyOptions = {
      algorithms: ['HS256' as const],
      issuer: jwt.issuer,
      audience: jwt.audience,
    };

    try {
      const payload = await this.jwtService.verifyAsync<MfaTokenPayload>(
        token,
        {
          secret: jwt.mfaSecret,
          ...verifyOptions,
        },
      );
      if (payload.typ === 'mfa') {
        const usuario = await this.usuarioRepo.findOne({
          where: { idUsuario: payload.sub, rol: 'admin' },
        });
        if (usuario) {
          return usuario;
        }
      }
    } catch {
      // No era un mfaToken válido: se intenta como access token de sesión.
    }

    try {
      const payload = await this.jwtService.verifyAsync<{
        sub: number;
        rol: string;
      }>(token, {
        secret: jwt.accessSecret,
        ...verifyOptions,
      });
      if (payload.rol === 'admin') {
        const usuario = await this.usuarioRepo.findOne({
          where: { idUsuario: payload.sub, rol: 'admin' },
        });
        if (usuario) {
          return usuario;
        }
      }
    } catch {
      // Ninguno de los dos tipos de token funcionó.
    }

    throw new UnauthorizedException('Token inválido o expirado');
  }

  issueMfaToken(usuario: Usuario): MfaChallengeResponse {
    const { jwt } = this.appConfig;
    const mfaToken = this.jwtService.sign(
      { sub: usuario.idUsuario, typ: 'mfa' },
      {
        secret: jwt.mfaSecret,
        algorithm: 'HS256',
        issuer: jwt.issuer,
        audience: jwt.audience,
        expiresIn: MFA_TOKEN_TTL_SECONDS,
      },
    );
    return usuario.totpActivo
      ? { mfaRequired: true, mfaToken }
      : { mfaSetupRequired: true, mfaToken };
  }

  async setup2fa(usuario: Usuario): Promise<Setup2faResponse> {
    const secret = generateTotpSecret();
    const encrypted = encryptTotpSecret(
      secret,
      this.appConfig.totpEncryptionKey,
    );

    // Deja 2FA inactivo hasta que /enable confirme el secreto NUEVO: evita
    // quedar con un secreto a medio configurar marcado como activo.
    await this.usuarioRepo.update(usuario.idUsuario, {
      totpSecreto: encrypted,
      totpActivo: false,
      totpUltimoContador: null,
    });

    const otpauthUri = totpKeyUri(usuario.correo, 'ClickSafe', secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUri);
    return { otpauthUri, qrCodeDataUrl };
  }

  async enable2fa(usuario: Usuario, codigo: string): Promise<void> {
    if (!usuario.totpSecreto) {
      throw new BadRequestException(
        'Primero configura el 2FA con /auth/2fa/setup.',
      );
    }
    if (this.lockoutService.isLocked(usuario)) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const { valid, counter } = this.checkTotpCode(usuario, codigo);
    if (!valid) {
      await this.lockoutService.registerFailedAttempt(usuario);
      await this.auditService.log({
        idUsuario: usuario.idUsuario,
        accion: '2fa_fallo',
        resultado: 'fallo',
      });
      throw new UnauthorizedException('Código inválido');
    }

    await this.usuarioRepo.update(usuario.idUsuario, {
      totpActivo: true,
      totpUltimoContador: String(counter),
    });
    await this.lockoutService.resetLockout(usuario.idUsuario);
    await this.auditService.log({
      idUsuario: usuario.idUsuario,
      accion: '2fa_activado',
      resultado: 'exito',
    });
  }

  async verify2fa(
    dto: MfaVerifyDto,
    meta: RequestMeta = {},
  ): Promise<TokensResponse> {
    const { jwt } = this.appConfig;
    let payload: MfaTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<MfaTokenPayload>(
        dto.mfaToken,
        {
          secret: jwt.mfaSecret,
          algorithms: ['HS256'],
          issuer: jwt.issuer,
          audience: jwt.audience,
        },
      );
    } catch {
      throw new UnauthorizedException(
        'Sesión de verificación inválida o expirada',
      );
    }

    const usuario = await this.usuarioRepo.findOne({
      where: { idUsuario: payload.sub, rol: 'admin' },
    });
    if (!usuario || !usuario.totpActivo || !usuario.totpSecreto) {
      throw new UnauthorizedException(
        'Sesión de verificación inválida o expirada',
      );
    }
    if (this.lockoutService.isLocked(usuario)) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const { valid, counter } = this.checkTotpCode(usuario, dto.codigo);
    if (!valid) {
      await this.lockoutService.registerFailedAttempt(usuario);
      await this.auditService.log({
        idUsuario: usuario.idUsuario,
        accion: '2fa_fallo',
        resultado: 'fallo',
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      throw new UnauthorizedException('Código inválido');
    }

    await this.usuarioRepo.update(usuario.idUsuario, {
      totpUltimoContador: String(counter),
    });
    await this.lockoutService.resetLockout(usuario.idUsuario);
    await this.auditService.log({
      idUsuario: usuario.idUsuario,
      accion: 'login',
      resultado: 'exito',
      ip: meta.ip,
      userAgent: meta.userAgent,
      detalle: { via: '2fa' },
    });

    return this.sessionService.issueSession(usuario, meta);
  }

  private checkTotpCode(
    usuario: Usuario,
    codigo: string,
  ): { valid: boolean; counter: number } {
    const secret = decryptTotpSecret(
      usuario.totpSecreto ?? '',
      this.appConfig.totpEncryptionKey,
    );
    const lastCounter =
      usuario.totpUltimoContador === null
        ? null
        : Number(usuario.totpUltimoContador);
    return verifyTotpCode(codigo, secret, lastCounter);
  }
}
