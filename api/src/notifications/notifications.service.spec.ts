import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Notificacion } from '../database/entities';
import { NotificationsService } from './notifications.service';

/**
 * Requisito del reporte (Fase 7): lectura de datos con escenario exitoso y
 * fallido. GET /notifications ("mis notificaciones") es de solo lectura y
 * siempre devuelve algo (vacío si no hay), así que el escenario fallido es
 * el único "lookup" real de este servicio: marcar como leída una
 * notificación que no es del usuario responde 404 (4.3, control de
 * propiedad en la misma consulta).
 */
describe('NotificationsService (lectura)', () => {
  function buildService(repo: Record<string, unknown>): NotificationsService {
    return new NotificationsService(
      repo as unknown as Repository<Notificacion>,
    );
  }

  describe('list (escenario exitoso)', () => {
    it('devuelve las notificaciones propias paginadas', async () => {
      const findAndCount = jest.fn().mockResolvedValue([
        [
          {
            idNotificacion: 1,
            tipo: 'reporte_validado',
            mensaje: 'Tu reporte fue validado.',
            leida: false,
            idReporte: 5,
            fechaCreacion: new Date('2026-01-01T00:00:00.000Z'),
          },
        ],
        1,
      ]);
      const service = buildService({ findAndCount });

      const result = await service.list(7, { page: 1, limit: 20 });

      expect(findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { idUsuario: 7 } }),
      );
      expect(result).toEqual({
        items: [
          {
            id: 1,
            tipo: 'reporte_validado',
            mensaje: 'Tu reporte fue validado.',
            leida: false,
            reporteId: 5,
            fechaCreacion: '2026-01-01T00:00:00.000Z',
          },
        ],
        page: 1,
        limit: 20,
        total: 1,
      });
    });
  });

  describe('markRead (escenario fallido)', () => {
    it('lanza NotFoundException si la notificación no existe o no es del usuario', async () => {
      const update = jest.fn().mockResolvedValue({ affected: 0 });
      const service = buildService({ update });

      await expect(service.markRead(999, 7)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(update).toHaveBeenCalledWith(
        { idNotificacion: 999, idUsuario: 7 },
        { leida: true },
      );
    });
  });
});
