/* eslint-disable @typescript-eslint/no-unsafe-assignment -- expect.any()/expect.anything() están tipados como `any` a propósito por Jest */
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { AppConfigService } from '../config/app-config.service';
import { AuditService } from '../audit/audit.service';
import { Sesion, Usuario } from '../database/entities';
import { SessionService } from './session.service';

describe('SessionService', () => {
  let service: SessionService;
  let sesionRepo: {
    save: jest.Mock;
    create: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
  };
  let jwtService: { sign: jest.Mock };
  let auditService: { log: jest.Mock };
  let nextId: number;

  const usuario = { idUsuario: 1, rol: 'usuario', activo: true } as Usuario;
  const admin = { idUsuario: 2, rol: 'admin', activo: true } as Usuario;

  beforeEach(() => {
    nextId = 100;
    sesionRepo = {
      create: jest.fn((data: Partial<Sesion>) => data),
      save: jest.fn((data: Partial<Sesion>) =>
        Promise.resolve({ ...data, idSesion: nextId++ }),
      ),
      findOne: jest.fn(),
      update: jest.fn(),
    };
    jwtService = { sign: jest.fn(() => 'signed.jwt.token') };
    auditService = { log: jest.fn() };
    const appConfig = {
      jwt: {
        accessSecret: 'secret',
        issuer: 'clicksafe-api',
        audience: 'clicksafe-app',
      },
    } as unknown as AppConfigService;

    service = new SessionService(
      jwtService as unknown as JwtService,
      appConfig,
      auditService as unknown as AuditService,
      sesionRepo as unknown as Repository<Sesion>,
    );
  });

  describe('signAccessToken', () => {
    it('marca mfa:true para admins y mfa:false para usuarios normales', () => {
      service.signAccessToken(usuario, 1);
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ mfa: false }),
        expect.anything(),
      );

      service.signAccessToken(admin, 2);
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ mfa: true }),
        expect.anything(),
      );
    });
  });

  describe('issueSession', () => {
    it('crea una sesión y devuelve access+refresh token', async () => {
      const result = await service.issueSession(usuario, { ip: '1.2.3.4' });

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.refreshToken).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(result.expiresIn).toBe(900);
      expect(sesionRepo.save).toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    const baseSesion = (overrides: Partial<Sesion> = {}): Sesion =>
      ({
        idSesion: 1,
        idUsuario: usuario.idUsuario,
        familia: 'familia-1',
        tokenHash: 'hash',
        expiraEn: new Date(Date.now() + 86_400_000),
        expiraAbsoluta: new Date(Date.now() + 86_400_000 * 30),
        reemplazadaEn: null,
        revocadaEn: null,
        usuario,
        ...overrides,
      }) as Sesion;

    it('rota el token: marca la vieja como reemplazada y crea una nueva de la misma familia', async () => {
      sesionRepo.findOne.mockResolvedValue(baseSesion());

      const result = await service.refresh('token-viejo');

      expect(sesionRepo.update).toHaveBeenCalledWith(1, {
        reemplazadaEn: expect.any(Date),
      });
      expect(result.refreshToken).toBeDefined();
      expect(result.refreshToken).not.toBe('token-viejo');
    });

    it('rechaza un token que no existe', async () => {
      sesionRepo.findOne.mockResolvedValue(null);

      await expect(service.refresh('inexistente')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rechaza y no revoca la familia si el token ya fue revocado explícitamente', async () => {
      sesionRepo.findOne.mockResolvedValue(
        baseSesion({ revocadaEn: new Date() }),
      );

      await expect(service.refresh('revocado')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('detecta reuso (token ya reemplazado): revoca toda la familia y audita', async () => {
      sesionRepo.findOne.mockResolvedValue(
        baseSesion({ reemplazadaEn: new Date() }),
      );

      await expect(service.refresh('ya-reemplazado')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );

      expect(sesionRepo.update).toHaveBeenCalledWith(
        { familia: 'familia-1', revocadaEn: expect.anything() },
        { revocadaEn: expect.any(Date) },
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          accion: 'refresh_reuso_detectado',
          resultado: 'fallo',
        }),
      );
    });

    it('rechaza un token cuya vida deslizante ya expiró', async () => {
      sesionRepo.findOne.mockResolvedValue(
        baseSesion({ expiraEn: new Date(Date.now() - 1000) }),
      );

      await expect(service.refresh('expirado')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rechaza un token cuya vida absoluta ya expiró', async () => {
      sesionRepo.findOne.mockResolvedValue(
        baseSesion({ expiraAbsoluta: new Date(Date.now() - 1000) }),
      );

      await expect(service.refresh('expirado-absoluto')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rechaza si el usuario de la sesión ya no está activo', async () => {
      sesionRepo.findOne.mockResolvedValue(
        baseSesion({ usuario: { ...usuario, activo: false } }),
      );

      await expect(service.refresh('usuario-inactivo')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('logout / logoutAll', () => {
    it('logout revoca solo la sesión indicada y audita logout con ip/userAgent (4.6)', async () => {
      await service.logout(5, 1, { ip: '203.0.113.5', userAgent: 'curl/8' });

      expect(sesionRepo.update).toHaveBeenCalledWith(
        { idSesion: 5, revocadaEn: expect.anything() },
        { revocadaEn: expect.any(Date) },
      );
      expect(auditService.log).toHaveBeenCalledWith({
        idUsuario: 1,
        accion: 'logout',
        resultado: 'exito',
        recursoTipo: 'Sesion',
        recursoId: 5,
        ip: '203.0.113.5',
        userAgent: 'curl/8',
      });
    });

    it('logoutAll revoca todas las sesiones activas del usuario y audita logout', async () => {
      await service.logoutAll(1, { ip: '203.0.113.5', userAgent: 'curl/8' });

      expect(sesionRepo.update).toHaveBeenCalledWith(
        { idUsuario: 1, revocadaEn: expect.anything() },
        { revocadaEn: expect.any(Date) },
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          idUsuario: 1,
          accion: 'logout',
          resultado: 'exito',
          ip: '203.0.113.5',
          userAgent: 'curl/8',
        }),
      );
    });
  });

  describe('revokeAllForUser', () => {
    it('revoca las sesiones pero NO audita logout (es efecto secundario de otra acción que ya audita la suya)', async () => {
      await service.revokeAllForUser(1);

      expect(sesionRepo.update).toHaveBeenCalledWith(
        { idUsuario: 1, revocadaEn: expect.anything() },
        { revocadaEn: expect.any(Date) },
      );
      expect(auditService.log).not.toHaveBeenCalled();
    });
  });
});
