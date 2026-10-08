import { BadRequestException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { Repository } from 'typeorm';
import { AppConfigService } from '../config/app-config.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { CaptchaService } from '../captcha/captcha.service';
import { TokenVerificacion, Usuario } from '../database/entities';
import { hashPassword } from '../common/utils/password-hash';
import { AuthService } from './auth.service';
import { LockoutService } from './lockout.service';
import { MfaService } from './mfa.service';
import { SessionService } from './session.service';

const CODE_HMAC_KEY = 'clave-de-prueba-para-codigos-123456789012';

function hashCode(idUsuario: number, tipo: string, codigo: string): string {
  return createHmac('sha256', CODE_HMAC_KEY)
    .update(`${idUsuario}:${tipo}:${codigo}`)
    .digest('hex');
}

describe('AuthService', () => {
  let service: AuthService;
  let appConfig: AppConfigService;
  let auditService: { log: jest.Mock };
  let mailService: { send: jest.Mock };
  let captchaService: { verify: jest.Mock };
  let lockoutService: {
    isLocked: jest.Mock;
    registerFailedAttempt: jest.Mock;
    resetLockout: jest.Mock;
  };
  let sessionService: { issueSession: jest.Mock; revokeAllForUser: jest.Mock };
  let mfaService: { issueMfaToken: jest.Mock };
  let usuarioRepo: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  let tokenRepo: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };

  const buildUsuario = (overrides: Partial<Usuario> = {}): Usuario =>
    ({
      idUsuario: 1,
      nombre: 'Ana',
      correo: 'ana@example.com',
      correoVerificado: true,
      passwordHash: '',
      rol: 'usuario',
      activo: true,
      intentosFallidos: 0,
      bloqueadoHasta: null,
      ...overrides,
    }) as Usuario;

  beforeEach(() => {
    auditService = { log: jest.fn() };
    mailService = { send: jest.fn() };
    captchaService = { verify: jest.fn().mockResolvedValue(true) };
    lockoutService = {
      isLocked: jest.fn(() => false),
      registerFailedAttempt: jest.fn(),
      resetLockout: jest.fn(),
    };
    sessionService = {
      issueSession: jest.fn().mockResolvedValue({
        accessToken: 'a',
        refreshToken: 'r',
        expiresIn: 900,
      }),
      revokeAllForUser: jest.fn(),
    };
    mfaService = {
      issueMfaToken: jest.fn(() => ({
        mfaRequired: true,
        mfaToken: 'mfa.token',
      })),
    };
    usuarioRepo = {
      findOne: jest.fn(),
      save: jest.fn((data: Partial<Usuario>) =>
        Promise.resolve({ idUsuario: 42, ...data }),
      ),
      create: jest.fn((data: Partial<Usuario>) => data),
      update: jest.fn(),
    };
    tokenRepo = {
      findOne: jest.fn(),
      save: jest.fn((data: Partial<TokenVerificacion>) =>
        Promise.resolve({ idToken: 1, ...data }),
      ),
      create: jest.fn((data: Partial<TokenVerificacion>) => data),
      update: jest.fn(),
      delete: jest.fn(),
    };
    appConfig = { codeHmacKey: CODE_HMAC_KEY } as unknown as AppConfigService;

    service = new AuthService(
      appConfig,
      auditService as unknown as AuditService,
      mailService as unknown as MailService,
      captchaService as unknown as CaptchaService,
      lockoutService as unknown as LockoutService,
      sessionService as unknown as SessionService,
      mfaService as unknown as MfaService,
      usuarioRepo as unknown as Repository<Usuario>,
      tokenRepo as unknown as Repository<TokenVerificacion>,
    );
  });

  describe('register', () => {
    it('crea el usuario y envía un código si el correo no existe', async () => {
      usuarioRepo.findOne.mockResolvedValue(null);

      const result = await service.register({
        nombre: 'Ana',
        correo: 'Ana@Example.com',
        password: 'Xk9#mPq2vL7zT4',
        captcha: 'captcha-valido',
      });

      expect(result.message).toMatch(/código de verificación/);
      expect(usuarioRepo.save).toHaveBeenCalled();
      expect(mailService.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'ana@example.com' }),
      );
    });

    it('responde igual (sin crear nada) si el correo ya existe, y avisa al dueño real', async () => {
      const existing = buildUsuario();
      usuarioRepo.findOne.mockResolvedValue(existing);

      const result = await service.register({
        nombre: 'Otro',
        correo: 'ana@example.com',
        password: 'Xk9#mPq2vL7zT4',
        captcha: 'captcha-valido',
      });

      expect(result.message).toMatch(/código de verificación/);
      expect(usuarioRepo.save).not.toHaveBeenCalled();
      expect(mailService.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'ana@example.com' }),
      );
    });

    it('rechaza el captcha inválido antes de validar cualquier otra cosa', async () => {
      captchaService.verify.mockResolvedValue(false);

      await expect(
        service.register({
          nombre: 'Ana',
          correo: 'ana@example.com',
          password: 'Xk9#mPq2vL7zT4',
          captcha: 'malo',
        }),
      ).rejects.toMatchObject({ response: { code: 'CAPTCHA_INVALID' } });
      expect(usuarioRepo.findOne).not.toHaveBeenCalled();
    });

    it('rechaza una contraseña débil', async () => {
      usuarioRepo.findOne.mockResolvedValue(null);

      await expect(
        service.register({
          nombre: 'Ana',
          correo: 'ana@example.com',
          password: '123456789',
          captcha: 'captcha-valido',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('verifyEmail', () => {
    it('marca el correo verificado con un código correcto', async () => {
      const usuario = buildUsuario({ correoVerificado: false });
      usuarioRepo.findOne.mockResolvedValue(usuario);
      tokenRepo.findOne.mockResolvedValue({
        idToken: 5,
        idUsuario: 1,
        tipo: 'verificacion_correo',
        tokenHash: hashCode(1, 'verificacion_correo', '123456'),
        intentos: 0,
        usadoEn: null,
        expiraEn: new Date(Date.now() + 60_000),
      });

      await service.verifyEmail({
        correo: 'ana@example.com',
        codigo: '123456',
      });

      expect(usuarioRepo.update).toHaveBeenCalledWith(1, {
        correoVerificado: true,
      });
    });

    it('rechaza un código incorrecto e incrementa los intentos', async () => {
      usuarioRepo.findOne.mockResolvedValue(buildUsuario());
      tokenRepo.findOne.mockResolvedValue({
        idToken: 5,
        idUsuario: 1,
        tipo: 'verificacion_correo',
        tokenHash: hashCode(1, 'verificacion_correo', '999999'),
        intentos: 0,
        usadoEn: null,
        expiraEn: new Date(Date.now() + 60_000),
      });

      await expect(
        service.verifyEmail({ correo: 'ana@example.com', codigo: '123456' }),
      ).rejects.toMatchObject({ response: { code: 'INVALID_CODE' } });
      expect(tokenRepo.update).toHaveBeenCalledWith(5, { intentos: 1 });
    });

    it('rechaza un código expirado', async () => {
      usuarioRepo.findOne.mockResolvedValue(buildUsuario());
      tokenRepo.findOne.mockResolvedValue({
        idToken: 5,
        idUsuario: 1,
        tipo: 'verificacion_correo',
        tokenHash: hashCode(1, 'verificacion_correo', '123456'),
        intentos: 0,
        usadoEn: null,
        expiraEn: new Date(Date.now() - 1000),
      });

      await expect(
        service.verifyEmail({ correo: 'ana@example.com', codigo: '123456' }),
      ).rejects.toMatchObject({ response: { code: 'INVALID_CODE' } });
    });

    it('responde igual si el correo no existe (sin filtrar que no existe)', async () => {
      usuarioRepo.findOne.mockResolvedValue(null);

      await expect(
        service.verifyEmail({
          correo: 'no-existe@example.com',
          codigo: '123456',
        }),
      ).rejects.toMatchObject({ response: { code: 'INVALID_CODE' } });
    });
  });

  describe('login', () => {
    it('devuelve tokens de sesión para un usuario normal verificado', async () => {
      const usuario = buildUsuario({
        passwordHash: await hashPassword('Xk9#mPq2vL7zT4'),
      });
      usuarioRepo.findOne.mockResolvedValue(usuario);

      const result = await service.login({
        correo: 'ana@example.com',
        password: 'Xk9#mPq2vL7zT4',
        captcha: 'ok',
      });

      expect(result).toEqual({
        accessToken: 'a',
        refreshToken: 'r',
        expiresIn: 900,
      });
      expect(lockoutService.resetLockout).toHaveBeenCalledWith(1);
    });

    it('devuelve un mfaToken en vez de sesión para un admin', async () => {
      const admin = buildUsuario({
        idUsuario: 2,
        rol: 'admin',
        passwordHash: await hashPassword('Xk9#mPq2vL7zT4'),
      });
      usuarioRepo.findOne.mockResolvedValue(admin);

      const result = await service.login({
        correo: 'ana@example.com',
        password: 'Xk9#mPq2vL7zT4',
        captcha: 'ok',
      });

      expect(result).toEqual({ mfaRequired: true, mfaToken: 'mfa.token' });
      expect(sessionService.issueSession).not.toHaveBeenCalled();
    });

    it('rechaza con mensaje genérico si el usuario no existe', async () => {
      usuarioRepo.findOne.mockResolvedValue(null);

      await expect(
        service.login({
          correo: 'no-existe@example.com',
          password: 'cualquiera12345',
          captcha: 'ok',
        }),
      ).rejects.toThrow('Credenciales inválidas');
    });

    it('rechaza con mensaje genérico si la contraseña es incorrecta, y registra el fallo', async () => {
      const usuario = buildUsuario({
        passwordHash: await hashPassword('Xk9#mPq2vL7zT4'),
      });
      usuarioRepo.findOne.mockResolvedValue(usuario);

      await expect(
        service.login({
          correo: 'ana@example.com',
          password: 'incorrecta123',
          captcha: 'ok',
        }),
      ).rejects.toThrow('Credenciales inválidas');
      expect(lockoutService.registerFailedAttempt).toHaveBeenCalledWith(
        usuario,
      );
    });

    it('rechaza con mensaje genérico si la cuenta está bloqueada, sin revelarlo', async () => {
      const usuario = buildUsuario({
        passwordHash: await hashPassword('Xk9#mPq2vL7zT4'),
        bloqueadoHasta: new Date(Date.now() + 60_000),
      });
      usuarioRepo.findOne.mockResolvedValue(usuario);
      lockoutService.isLocked.mockReturnValue(true);

      await expect(
        service.login({
          correo: 'ana@example.com',
          password: 'Xk9#mPq2vL7zT4',
          captcha: 'ok',
        }),
      ).rejects.toThrow('Credenciales inválidas');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ accion: 'cuenta_bloqueada' }),
      );
    });

    it('rechaza con mensaje genérico si el usuario está inactivo', async () => {
      const usuario = buildUsuario({
        passwordHash: await hashPassword('Xk9#mPq2vL7zT4'),
        activo: false,
      });
      usuarioRepo.findOne.mockResolvedValue(usuario);

      await expect(
        service.login({
          correo: 'ana@example.com',
          password: 'Xk9#mPq2vL7zT4',
          captcha: 'ok',
        }),
      ).rejects.toThrow('Credenciales inválidas');
    });

    it('responde 403 EMAIL_NOT_VERIFIED si la contraseña es correcta pero el correo no está verificado', async () => {
      const usuario = buildUsuario({
        passwordHash: await hashPassword('Xk9#mPq2vL7zT4'),
        correoVerificado: false,
      });
      usuarioRepo.findOne.mockResolvedValue(usuario);

      await expect(
        service.login({
          correo: 'ana@example.com',
          password: 'Xk9#mPq2vL7zT4',
          captcha: 'ok',
        }),
      ).rejects.toMatchObject({
        response: { code: 'EMAIL_NOT_VERIFIED' },
      });
    });

    it('rechaza el captcha inválido antes de tocar la base de datos', async () => {
      captchaService.verify.mockResolvedValue(false);

      await expect(
        service.login({
          correo: 'ana@example.com',
          password: 'cualquiera',
          captcha: 'malo',
        }),
      ).rejects.toMatchObject({ response: { code: 'CAPTCHA_INVALID' } });
      expect(usuarioRepo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('forgotPassword / resetPassword', () => {
    it('forgotPassword siempre responde el mensaje genérico', async () => {
      usuarioRepo.findOne.mockResolvedValue(null);

      const result = await service.forgotPassword({
        correo: 'nadie@example.com',
        captcha: 'ok',
      });

      expect(result.message).toMatch(/código de recuperación/);
    });

    it('resetPassword cambia la contraseña, revoca sesiones y audita', async () => {
      const usuario = buildUsuario();
      usuarioRepo.findOne.mockResolvedValue(usuario);
      tokenRepo.findOne.mockResolvedValue({
        idToken: 9,
        idUsuario: 1,
        tipo: 'recuperacion_password',
        tokenHash: hashCode(1, 'recuperacion_password', '12345678'),
        intentos: 0,
        usadoEn: null,
        expiraEn: new Date(Date.now() + 60_000),
      });

      const result = await service.resetPassword({
        correo: 'ana@example.com',
        codigo: '12345678',
        nuevaPassword: 'Xk9#mPq2vL7zT4',
        captcha: 'ok',
      });

      expect(result.message).toMatch(/actualizada/);
      expect(sessionService.revokeAllForUser).toHaveBeenCalledWith(1);
      expect(lockoutService.resetLockout).toHaveBeenCalledWith(1);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          accion: 'password_cambiada',
          resultado: 'exito',
        }),
      );
      expect(mailService.send).toHaveBeenCalled();
    });

    it('resetPassword rechaza un código incorrecto', async () => {
      usuarioRepo.findOne.mockResolvedValue(buildUsuario());
      tokenRepo.findOne.mockResolvedValue({
        idToken: 9,
        idUsuario: 1,
        tipo: 'recuperacion_password',
        tokenHash: hashCode(1, 'recuperacion_password', '00000000'),
        intentos: 0,
        usadoEn: null,
        expiraEn: new Date(Date.now() + 60_000),
      });

      await expect(
        service.resetPassword({
          correo: 'ana@example.com',
          codigo: '12345678',
          nuevaPassword: 'Xk9#mPq2vL7zT4',
          captcha: 'ok',
        }),
      ).rejects.toMatchObject({ response: { code: 'INVALID_CODE' } });
    });
  });

  describe('invalidación de códigos anteriores del mismo tipo (5.3)', () => {
    // tokenRepo/usuarioRepo con estado real (no solo jest.fn() sueltos):
    // se necesita que delete/save/findOne se comporten como una tabla de
    // verdad para comprobar que pedir un segundo código invalida el primero.
    function buildStatefulReposAndService() {
      interface FakeToken {
        idToken: number;
        idUsuario: number;
        tipo: string;
        tokenHash: string;
        intentos: number;
        usadoEn: Date | null;
        expiraEn: Date;
      }
      const tokenStore = new Map<string, FakeToken>();
      let nextTokenId = 1;
      const tokenKey = (idUsuario: number, tipo: string): string =>
        `${idUsuario}:${tipo}`;

      const statefulTokenRepo = {
        findOne: jest.fn(
          ({ where }: { where: { idUsuario: number; tipo: string } }) =>
            Promise.resolve(
              tokenStore.get(tokenKey(where.idUsuario, where.tipo)) ?? null,
            ),
        ),
        delete: jest.fn(
          ({ idUsuario, tipo }: { idUsuario: number; tipo: string }) => {
            tokenStore.delete(tokenKey(idUsuario, tipo));
            return Promise.resolve({ affected: 1 });
          },
        ),
        create: jest.fn((data: Partial<FakeToken>) => data as FakeToken),
        save: jest.fn((data: Partial<FakeToken>) => {
          const row = {
            idToken: nextTokenId++,
            intentos: 0,
            usadoEn: null,
            ...data,
          } as FakeToken;
          tokenStore.set(tokenKey(row.idUsuario, row.tipo), row);
          return Promise.resolve(row);
        }),
        update: jest.fn((idToken: number, patch: Partial<FakeToken>) => {
          for (const row of tokenStore.values()) {
            if (row.idToken === idToken) {
              Object.assign(row, patch);
            }
          }
          return Promise.resolve({ affected: 1 });
        }),
      };

      const usuario = buildUsuario({ correoVerificado: false });
      const statefulUsuarioRepo = {
        findOne: jest.fn(() => Promise.resolve(usuario)),
        save: jest.fn((data: Partial<Usuario>) =>
          Promise.resolve({ ...usuario, ...data }),
        ),
        create: jest.fn((data: Partial<Usuario>) => data),
        update: jest.fn((idUsuario: number, patch: Partial<Usuario>) => {
          Object.assign(usuario, patch);
          return Promise.resolve({ affected: 1 });
        }),
      };

      const localMailService = {
        send: jest
          .fn<Promise<void>, [{ text: string }]>()
          .mockResolvedValue(undefined),
      };
      const localService = new AuthService(
        appConfig,
        auditService as unknown as AuditService,
        localMailService as unknown as MailService,
        captchaService as unknown as CaptchaService,
        lockoutService as unknown as LockoutService,
        sessionService as unknown as SessionService,
        mfaService as unknown as MfaService,
        statefulUsuarioRepo as unknown as Repository<Usuario>,
        statefulTokenRepo as unknown as Repository<TokenVerificacion>,
      );

      return { localService, localMailService, usuario };
    }

    function extractCode(
      sendMock: jest.Mock<Promise<void>, [{ text: string }]>,
    ): string {
      const lastCall = sendMock.mock.calls.at(-1);
      const match = /código es (\d+)/.exec(lastCall?.[0]?.text ?? '');
      if (!match) {
        throw new Error(
          'No se encontró un código en el correo enviado (prueba mal construida).',
        );
      }
      return match[1];
    }

    it('verificación de correo: pedir un segundo código invalida el primero, aunque no haya expirado', async () => {
      const { localService, localMailService } = buildStatefulReposAndService();

      await localService.resendVerification({
        correo: 'ana@example.com',
        captcha: 'ok',
      });
      const primerCodigo = extractCode(localMailService.send);

      await localService.resendVerification({
        correo: 'ana@example.com',
        captcha: 'ok',
      });
      const segundoCodigo = extractCode(localMailService.send);

      expect(primerCodigo).not.toBe(segundoCodigo);

      // El primer código, aunque todavía estaría dentro de sus 30 min de
      // vigencia, ya no corresponde a ninguna fila: debe rechazarse.
      await expect(
        localService.verifyEmail({
          correo: 'ana@example.com',
          codigo: primerCodigo,
        }),
      ).rejects.toMatchObject({ response: { code: 'INVALID_CODE' } });

      // El segundo (el vigente) sí debe funcionar.
      await expect(
        localService.verifyEmail({
          correo: 'ana@example.com',
          codigo: segundoCodigo,
        }),
      ).resolves.toBeUndefined();
    });

    it('recuperación de contraseña: pedir un segundo código invalida el primero, aunque no haya expirado', async () => {
      const { localService, localMailService, usuario } =
        buildStatefulReposAndService();
      usuario.activo = true;

      await localService.forgotPassword({
        correo: 'ana@example.com',
        captcha: 'ok',
      });
      const primerCodigo = extractCode(localMailService.send);

      await localService.forgotPassword({
        correo: 'ana@example.com',
        captcha: 'ok',
      });
      const segundoCodigo = extractCode(localMailService.send);

      expect(primerCodigo).not.toBe(segundoCodigo);

      await expect(
        localService.resetPassword({
          correo: 'ana@example.com',
          codigo: primerCodigo,
          nuevaPassword: 'Xk9#mPq2vL7zT4',
          captcha: 'ok',
        }),
      ).rejects.toMatchObject({ response: { code: 'INVALID_CODE' } });

      const result = await localService.resetPassword({
        correo: 'ana@example.com',
        codigo: segundoCodigo,
        nuevaPassword: 'Xk9#mPq2vL7zT4',
        captcha: 'ok',
      });
      expect(result.message).toMatch(/actualizada/);
    });
  });
});
