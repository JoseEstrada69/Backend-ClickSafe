import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { AppConfigService } from '../../config/app-config.service';
import { Sesion, Usuario } from '../../database/entities';
import { MfaOrAdminSessionGuard } from './mfa-or-admin-session.guard';
import type { MfaAuthenticatedRequest } from '../interfaces/mfa-authenticated-request.interface';

describe('MfaOrAdminSessionGuard', () => {
  let guard: MfaOrAdminSessionGuard;
  let jwtService: { verifyAsync: jest.Mock };
  let usuarioRepo: { findOne: jest.Mock };
  let sesionRepo: { findOne: jest.Mock };
  let appConfig: AppConfigService;

  const admin: Usuario = { idUsuario: 1, rol: 'admin' } as Usuario;

  const buildContext = (
    request: Partial<MfaAuthenticatedRequest>,
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jwtService = { verifyAsync: jest.fn() };
    usuarioRepo = { findOne: jest.fn() };
    sesionRepo = { findOne: jest.fn() };
    appConfig = {
      jwt: {
        accessSecret: 'access-secret',
        mfaSecret: 'mfa-secret',
        issuer: 'clicksafe-api',
        audience: 'clicksafe-app',
      },
    } as unknown as AppConfigService;

    guard = new MfaOrAdminSessionGuard(
      jwtService as unknown as JwtService,
      appConfig,
      usuarioRepo as unknown as Repository<Usuario>,
      sesionRepo as unknown as Repository<Sesion>,
    );
  });

  it('rechaza si no hay header Authorization', async () => {
    const context = buildContext({ headers: {} });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('acepta un mfaToken válido (typ: mfa) y deja al admin en request.mfaAdmin', async () => {
    jwtService.verifyAsync.mockImplementation((_token, { secret }) => {
      if (secret === 'mfa-secret') {
        return Promise.resolve({ sub: 1, typ: 'mfa' });
      }
      return Promise.reject(new Error('firma inválida'));
    });
    usuarioRepo.findOne.mockResolvedValue(admin);
    const request: Partial<MfaAuthenticatedRequest> = {
      headers: { authorization: 'Bearer mfa.token.here' },
    };
    const context = buildContext(request);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.mfaAdmin).toBe(admin);
    expect(sesionRepo.findOne).not.toHaveBeenCalled();
  });

  it('acepta el access token de una sesión admin ya completada (reconfigurar 2FA)', async () => {
    jwtService.verifyAsync.mockImplementation((_token, { secret }) => {
      if (secret === 'access-secret') {
        return Promise.resolve({ sub: 1, rol: 'admin', sid: '42', mfa: true });
      }
      return Promise.reject(new Error('firma inválida'));
    });
    sesionRepo.findOne.mockResolvedValue({
      idSesion: 42,
      revocadaEn: null,
      usuario: { activo: true },
    });
    usuarioRepo.findOne.mockResolvedValue(admin);
    const request: Partial<MfaAuthenticatedRequest> = {
      headers: { authorization: 'Bearer access.token.here' },
    };
    const context = buildContext(request);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.mfaAdmin).toBe(admin);
  });

  it('rechaza el access token de un usuario normal (no admin)', async () => {
    jwtService.verifyAsync.mockImplementation((_token, { secret }) => {
      if (secret === 'access-secret') {
        return Promise.resolve({
          sub: 2,
          rol: 'usuario',
          sid: '7',
          mfa: false,
        });
      }
      return Promise.reject(new Error('firma inválida'));
    });
    const context = buildContext({
      headers: { authorization: 'Bearer usuario.access.token' },
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(usuarioRepo.findOne).not.toHaveBeenCalled();
  });

  it('rechaza el access token de un admin cuya sesión fue revocada', async () => {
    jwtService.verifyAsync.mockImplementation((_token, { secret }) => {
      if (secret === 'access-secret') {
        return Promise.resolve({ sub: 1, rol: 'admin', sid: '42', mfa: true });
      }
      return Promise.reject(new Error('firma inválida'));
    });
    sesionRepo.findOne.mockResolvedValue({
      idSesion: 42,
      revocadaEn: new Date(),
      usuario: { activo: true },
    });
    const context = buildContext({
      headers: { authorization: 'Bearer revoked.session.token' },
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rechaza un mfaToken expirado (no cae de vuelta a aceptarlo como access token)', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));
    const context = buildContext({
      headers: { authorization: 'Bearer expired.mfa.token' },
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(usuarioRepo.findOne).not.toHaveBeenCalled();
  });

  it('nunca intercambia los dos tipos de token: un mfaToken no se valida con el secreto de access token', async () => {
    // Firmado con mfa-secret: falla al verificarse con access-secret y con
    // mfa-secret solo tiene éxito si además typ === 'mfa'.
    jwtService.verifyAsync.mockImplementation((_token, { secret }) => {
      if (secret === 'mfa-secret') {
        return Promise.resolve({ sub: 1, typ: 'otro' });
      }
      return Promise.reject(new Error('firma inválida'));
    });
    const context = buildContext({
      headers: { authorization: 'Bearer token.con.typ.distinto' },
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
