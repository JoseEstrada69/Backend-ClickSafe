import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { AppConfigService } from '../config/app-config.service';
import { Sesion, Usuario } from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { TokensResponse } from './auth-responses.interface';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 5.6
const REFRESH_TOKEN_SLIDING_DAYS = 7;
const REFRESH_TOKEN_ABSOLUTE_DAYS = 30;

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Sesiones y tokens (5.6). El access token es un JWT de 15 min; el
 * refresh token son 32 bytes aleatorios en base64url (NO es JWT) — en BD
 * solo se guarda su SHA-256. Rotación con detección de reuso: cada uso
 * marca la fila `reemplazada_en` y crea una nueva de la misma `familia`;
 * si llega un token ya reemplazado, se revoca toda la familia.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly appConfig: AppConfigService,
    private readonly auditService: AuditService,
    @InjectRepository(Sesion)
    private readonly sesionRepo: Repository<Sesion>,
  ) {}

  /** Admins solo tienen sesión completa tras 2FA: por eso el claim `mfa` se deriva del rol, no se guarda en Sesion. */
  signAccessToken(usuario: Usuario, idSesion: number): string {
    const { jwt } = this.appConfig;
    return this.jwtService.sign(
      {
        sub: usuario.idUsuario,
        rol: usuario.rol,
        sid: String(idSesion),
        mfa: usuario.rol === 'admin',
      },
      {
        secret: jwt.accessSecret,
        algorithm: 'HS256',
        issuer: jwt.issuer,
        audience: jwt.audience,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      },
    );
  }

  async issueSession(
    usuario: Usuario,
    meta: RequestMeta = {},
  ): Promise<TokensResponse> {
    const now = Date.now();
    const refreshTokenPlain = randomBytes(32).toString('base64url');
    const sesion = await this.sesionRepo.save(
      this.sesionRepo.create({
        idUsuario: usuario.idUsuario,
        familia: randomUUID(),
        tokenHash: this.hashToken(refreshTokenPlain),
        expiraEn: new Date(now + REFRESH_TOKEN_SLIDING_DAYS * 86_400_000),
        expiraAbsoluta: new Date(
          now + REFRESH_TOKEN_ABSOLUTE_DAYS * 86_400_000,
        ),
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      }),
    );

    return {
      accessToken: this.signAccessToken(usuario, sesion.idSesion),
      refreshToken: refreshTokenPlain,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  async refresh(
    refreshTokenPlain: string,
    meta: RequestMeta = {},
  ): Promise<TokensResponse> {
    const tokenHash = this.hashToken(refreshTokenPlain);
    const sesion = await this.sesionRepo.findOne({
      where: { tokenHash },
      relations: { usuario: true },
    });

    if (!sesion || sesion.revocadaEn) {
      throw new UnauthorizedException('Token inválido o expirado');
    }

    if (sesion.reemplazadaEn) {
      // Reuso: este token ya se cambió por uno nuevo antes. O lo robaron,
      // o hay una carrera entre dos clientes con el mismo token — en
      // ambos casos, se revoca toda la familia (5.6).
      await this.revokeFamily(sesion.familia);
      await this.auditService.log({
        idUsuario: sesion.idUsuario,
        accion: 'refresh_reuso_detectado',
        resultado: 'fallo',
        recursoTipo: 'Sesion',
        recursoId: sesion.idSesion,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      throw new UnauthorizedException('Token inválido o expirado');
    }

    const now = Date.now();
    if (
      sesion.expiraEn.getTime() < now ||
      sesion.expiraAbsoluta.getTime() < now ||
      !sesion.usuario.activo
    ) {
      throw new UnauthorizedException('Token inválido o expirado');
    }

    await this.sesionRepo.update(sesion.idSesion, {
      reemplazadaEn: new Date(),
    });

    const refreshTokenNuevo = randomBytes(32).toString('base64url');
    const nueva = await this.sesionRepo.save(
      this.sesionRepo.create({
        idUsuario: sesion.idUsuario,
        familia: sesion.familia,
        tokenHash: this.hashToken(refreshTokenNuevo),
        // Deslizante: se extiende; el absoluto NUNCA se extiende (5.6).
        expiraEn: new Date(now + REFRESH_TOKEN_SLIDING_DAYS * 86_400_000),
        expiraAbsoluta: sesion.expiraAbsoluta,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      }),
    );

    return {
      accessToken: this.signAccessToken(sesion.usuario, nueva.idSesion),
      refreshToken: refreshTokenNuevo,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  async logout(idSesion: number): Promise<void> {
    await this.sesionRepo.update(
      { idSesion, revocadaEn: IsNull() },
      { revocadaEn: new Date() },
    );
  }

  async logoutAll(idUsuario: number): Promise<void> {
    await this.sesionRepo.update(
      { idUsuario, revocadaEn: IsNull() },
      { revocadaEn: new Date() },
    );
  }

  /** Usado por restablecimiento de contraseña (5.7) y suspensión de usuario. */
  async revokeAllForUser(idUsuario: number): Promise<void> {
    await this.logoutAll(idUsuario);
  }

  /**
   * Usado por PATCH /me/password: revoca las DEMÁS sesiones pero deja la
   * actual activa, para no cerrar la sesión del propio dispositivo desde
   * el que se cambió la contraseña.
   */
  async revokeAllExceptCurrent(
    idUsuario: number,
    idSesionActual: number,
  ): Promise<void> {
    await this.sesionRepo.update(
      { idUsuario, revocadaEn: IsNull(), idSesion: Not(idSesionActual) },
      { revocadaEn: new Date() },
    );
  }

  private async revokeFamily(familia: string): Promise<void> {
    await this.sesionRepo.update(
      { familia, revocadaEn: IsNull() },
      { revocadaEn: new Date() },
    );
  }

  private hashToken(tokenPlain: string): string {
    return createHash('sha256').update(tokenPlain).digest('hex');
  }
}
