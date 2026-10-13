/* eslint-disable @typescript-eslint/no-unsafe-assignment -- expect.any() está tipado como `any` a propósito por Jest */
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { CommentsService } from '../comments/comments.service';
import { hashPassword } from '../common/utils/password-hash';
import { Usuario } from '../database/entities';
import { ReportsService } from '../reports/reports.service';
import { MeService } from './me.service';

describe('MeService', () => {
  let service: MeService;
  let auditService: { log: jest.Mock };
  let sessionService: { revokeAllExceptCurrent: jest.Mock };
  let reportsService: { getMyReports: jest.Mock };
  let commentsService: { listMyComments: jest.Mock };
  let usuarioRepo: { findOne: jest.Mock; update: jest.Mock };

  const buildUsuario = (overrides: Partial<Usuario> = {}): Usuario =>
    ({
      idUsuario: 1,
      nombre: 'Ana',
      correo: 'ana@example.com',
      rol: 'usuario',
      totpActivo: false,
      fechaRegistro: new Date('2026-01-01T00:00:00.000Z'),
      passwordHash: '',
      ...overrides,
    }) as Usuario;

  beforeEach(() => {
    auditService = { log: jest.fn() };
    sessionService = { revokeAllExceptCurrent: jest.fn() };
    reportsService = { getMyReports: jest.fn() };
    commentsService = { listMyComments: jest.fn() };
    usuarioRepo = { findOne: jest.fn(), update: jest.fn() };

    service = new MeService(
      auditService as unknown as AuditService,
      sessionService as unknown as SessionService,
      reportsService as unknown as ReportsService,
      commentsService as unknown as CommentsService,
      usuarioRepo as unknown as Repository<Usuario>,
    );
  });

  describe('getMe', () => {
    it('devuelve el perfil sin datos sensibles', async () => {
      usuarioRepo.findOne.mockResolvedValue(buildUsuario());

      const result = await service.getMe(1);

      expect(result).toEqual({
        nombre: 'Ana',
        correo: 'ana@example.com',
        rol: 'usuario',
        fechaRegistro: '2026-01-01T00:00:00.000Z',
        totpActivo: false,
      });
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('lanza 404 si el usuario no existe', async () => {
      usuarioRepo.findOne.mockResolvedValue(null);

      await expect(service.getMe(999)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('updateMe', () => {
    it('actualiza el nombre y devuelve el perfil actualizado', async () => {
      usuarioRepo.findOne
        .mockResolvedValueOnce(buildUsuario())
        .mockResolvedValueOnce(buildUsuario({ nombre: 'Ana María' }));

      const result = await service.updateMe(1, { nombre: 'Ana María' });

      expect(usuarioRepo.update).toHaveBeenCalledWith(1, {
        nombre: 'Ana María',
      });
      expect(result.nombre).toBe('Ana María');
    });
  });

  describe('changePassword', () => {
    it('cambia la contraseña y revoca las demás sesiones (no la actual)', async () => {
      const usuario = buildUsuario({
        passwordHash: await hashPassword('ActualSegura123'),
      });
      usuarioRepo.findOne.mockResolvedValue(usuario);

      await service.changePassword(1, 42, {
        passwordActual: 'ActualSegura123',
        nuevaPassword: 'Xk9#mPq2vL7zT4',
      });

      expect(usuarioRepo.update).toHaveBeenCalledWith(1, {
        passwordHash: expect.any(String),
      });
      expect(sessionService.revokeAllExceptCurrent).toHaveBeenCalledWith(1, 42);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          accion: 'password_cambiada',
          resultado: 'exito',
        }),
      );
    });

    it('rechaza si la contraseña actual es incorrecta', async () => {
      const usuario = buildUsuario({
        passwordHash: await hashPassword('ActualSegura123'),
      });
      usuarioRepo.findOne.mockResolvedValue(usuario);

      await expect(
        service.changePassword(1, 42, {
          passwordActual: 'incorrecta',
          nuevaPassword: 'Xk9#mPq2vL7zT4',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(sessionService.revokeAllExceptCurrent).not.toHaveBeenCalled();
    });

    it('rechaza una nueva contraseña débil', async () => {
      const usuario = buildUsuario({
        passwordHash: await hashPassword('ActualSegura123'),
      });
      usuarioRepo.findOne.mockResolvedValue(usuario);

      await expect(
        service.changePassword(1, 42, {
          passwordActual: 'ActualSegura123',
          nuevaPassword: '123456789',
        }),
      ).rejects.toThrow(/demasiado común/);
    });
  });
});
