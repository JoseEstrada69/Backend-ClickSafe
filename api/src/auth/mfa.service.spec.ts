import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { authenticator } from 'otplib';
import { Repository } from 'typeorm';
import { AppConfigService } from '../config/app-config.service';
import { AuditService } from '../audit/audit.service';
import { Usuario } from '../database/entities';
import { LockoutService } from './lockout.service';
import { MfaService } from './mfa.service';
import { SessionService } from './session.service';
import { encryptTotpSecret } from './utils/totp-encryption';
import { generateTotpSecret } from './utils/totp';

describe('MfaService', () => {
  let service: MfaService;
  let jwtService: { sign: jest.Mock; verifyAsync: jest.Mock };
  let auditService: { log: jest.Mock };
  let lockoutService: {
    isLocked: jest.Mock;
    registerFailedAttempt: jest.Mock;
    resetLockout: jest.Mock;
  };
  let sessionService: { issueSession: jest.Mock };
  let usuarioRepo: { findOne: jest.Mock; update: jest.Mock };
  let appConfig: AppConfigService;

  const TOTP_KEY = Buffer.alloc(32, 9).toString('base64');

  const buildAdmin = (overrides: Partial<Usuario> = {}): Usuario =>
    ({
      idUsuario: 7,
      correo: 'admin@clicksafe.local',
      rol: 'admin',
      totpActivo: false,
      totpSecreto: null,
      totpUltimoContador: null,
      bloqueadoHasta: null,
      ...overrides,
    }) as Usuario;

  beforeEach(() => {
    jwtService = {
      sign: jest.fn(() => 'mfa.jwt.token'),
      verifyAsync: jest.fn(),
    };
    auditService = { log: jest.fn() };
    lockoutService = {
      isLocked: jest.fn(() => false),
      registerFailedAttempt: jest.fn(),
      resetLockout: jest.fn(),
    };
    sessionService = {
      issueSession: jest.fn(() =>
        Promise.resolve({
          accessToken: 'a',
          refreshToken: 'r',
          expiresIn: 900,
        }),
      ),
    };
    usuarioRepo = { findOne: jest.fn(), update: jest.fn() };
    appConfig = {
      jwt: {
        mfaSecret: 'mfa-secret',
        accessSecret: 'access-secret',
        issuer: 'clicksafe-api',
        audience: 'clicksafe-app',
      },
      totpEncryptionKey: TOTP_KEY,
    } as unknown as AppConfigService;

    service = new MfaService(
      jwtService as unknown as JwtService,
      appConfig,
      auditService as unknown as AuditService,
      lockoutService as unknown as LockoutService,
      sessionService as unknown as SessionService,
      usuarioRepo as unknown as Repository<Usuario>,
    );
  });

  describe('issueMfaToken', () => {
    it('devuelve mfaRequired si el admin ya tiene 2FA activo', () => {
      const result = service.issueMfaToken(buildAdmin({ totpActivo: true }));
      expect(result).toEqual({ mfaRequired: true, mfaToken: 'mfa.jwt.token' });
    });

    it('devuelve mfaSetupRequired si el admin aún no configura 2FA', () => {
      const result = service.issueMfaToken(buildAdmin({ totpActivo: false }));
      expect(result).toEqual({
        mfaSetupRequired: true,
        mfaToken: 'mfa.jwt.token',
      });
    });
  });

  describe('setup2fa', () => {
    it('genera un secreto cifrado y deja totpActivo en false hasta confirmar', async () => {
      const result = await service.setup2fa(buildAdmin());

      expect(result.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
      expect(result.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
      expect(usuarioRepo.update).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          totpActivo: false,
          totpUltimoContador: null,
        }),
      );
    });
  });

  describe('enable2fa', () => {
    it('activa 2FA con un código válido', async () => {
      const secret = generateTotpSecret();
      const admin = buildAdmin({
        totpSecreto: encryptTotpSecret(secret, TOTP_KEY),
      });
      const code = authenticator.generate(secret);

      await service.enable2fa(admin, code);

      expect(usuarioRepo.update).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ totpActivo: true }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ accion: '2fa_activado', resultado: 'exito' }),
      );
    });

    it('rechaza un código inválido y registra el fallo', async () => {
      const secret = generateTotpSecret();
      const admin = buildAdmin({
        totpSecreto: encryptTotpSecret(secret, TOTP_KEY),
      });

      await expect(service.enable2fa(admin, '000000')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(lockoutService.registerFailedAttempt).toHaveBeenCalledWith(admin);
    });

    it('rechaza si no se ha llamado antes a setup2fa', async () => {
      await expect(
        service.enable2fa(buildAdmin(), '123456'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza si la cuenta está bloqueada', async () => {
      lockoutService.isLocked.mockReturnValue(true);
      const admin = buildAdmin({
        totpSecreto: encryptTotpSecret(generateTotpSecret(), TOTP_KEY),
      });

      await expect(service.enable2fa(admin, '123456')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('verify2fa', () => {
    it('emite una sesión completa con un código válido', async () => {
      const secret = generateTotpSecret();
      const admin = buildAdmin({
        totpActivo: true,
        totpSecreto: encryptTotpSecret(secret, TOTP_KEY),
      });
      jwtService.verifyAsync.mockResolvedValue({ sub: 7, typ: 'mfa' });
      usuarioRepo.findOne.mockResolvedValue(admin);
      const code = authenticator.generate(secret);

      const result = await service.verify2fa({
        mfaToken: 'token',
        codigo: code,
      });

      expect(result).toEqual({
        accessToken: 'a',
        refreshToken: 'r',
        expiresIn: 900,
      });
      expect(sessionService.issueSession).toHaveBeenCalledWith(admin, {});
    });

    it('rechaza un mfaToken inválido o expirado', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));

      await expect(
        service.verify2fa({ mfaToken: 'malo', codigo: '123456' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rechaza si el admin no tiene 2FA activo todavía', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 7, typ: 'mfa' });
      usuarioRepo.findOne.mockResolvedValue(buildAdmin({ totpActivo: false }));

      await expect(
        service.verify2fa({ mfaToken: 'token', codigo: '123456' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rechaza un código incorrecto y registra el fallo', async () => {
      const secret = generateTotpSecret();
      const admin = buildAdmin({
        totpActivo: true,
        totpSecreto: encryptTotpSecret(secret, TOTP_KEY),
      });
      jwtService.verifyAsync.mockResolvedValue({ sub: 7, typ: 'mfa' });
      usuarioRepo.findOne.mockResolvedValue(admin);

      await expect(
        service.verify2fa({ mfaToken: 'token', codigo: '000000' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(lockoutService.registerFailedAttempt).toHaveBeenCalledWith(admin);
      expect(sessionService.issueSession).not.toHaveBeenCalled();
    });
  });
});
