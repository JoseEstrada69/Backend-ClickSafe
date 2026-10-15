import { NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';

/**
 * Requisito del reporte (Fase 7): lectura de datos con escenario exitoso y
 * fallido. GET /admin/stats es el ejemplo de "estadísticas admin" que pide
 * CLAUDE.md; GET /admin/reports/:id aporta el escenario fallido (detalle
 * inexistente), igual que ya existe para el detalle público de reportes.
 */
describe('AdminService (lectura)', () => {
  const noop = {} as never;

  /** Query builder encadenable genérico: sirve para las 4 consultas de getStats (cada una usa un subconjunto distinto de estos métodos). */
  function buildQueryBuilder(rawMany: unknown[]) {
    const qb: Record<string, jest.Mock> = {};
    for (const method of [
      'innerJoin',
      'select',
      'addSelect',
      'where',
      'andWhere',
      'groupBy',
      'orderBy',
    ]) {
      qb[method] = jest.fn().mockReturnValue(qb);
    }
    qb.getRawMany = jest.fn().mockResolvedValue(rawMany);
    return qb;
  }

  function buildService(reporteRepo: Record<string, unknown>): AdminService {
    return new AdminService(
      noop, // dataSource
      noop, // auditService
      noop, // sessionService
      noop, // authService
      noop, // mfaService
      noop, // notificationsService
      noop, // evidenceUrlService
      noop, // storageService
      reporteRepo as never,
      noop, // evidenciaRepo
      noop, // revisionRepo
      noop, // comentarioRepo
      noop, // denunciaRepo
      noop, // usuarioRepo
      noop, // bitacoraRepo
      noop, // plataformaRepo
      noop, // categoriaRepo
    );
  }

  describe('getStats (escenario exitoso)', () => {
    it('agrega reportes por plataforma, categoría, estado y mes', async () => {
      const qbPlataforma = buildQueryBuilder([
        { plataforma: 'Mercado Libre', total: '5' },
      ]);
      const qbCategoria = buildQueryBuilder([
        { categoria: 'Producto no entregado', total: '5' },
      ]);
      const qbEstado = buildQueryBuilder([{ estado: 'pendiente', total: '5' }]);
      const qbMes = buildQueryBuilder([]);
      const reporteRepo = {
        createQueryBuilder: jest
          .fn()
          .mockReturnValueOnce(qbPlataforma)
          .mockReturnValueOnce(qbCategoria)
          .mockReturnValueOnce(qbEstado)
          .mockReturnValueOnce(qbMes),
      };
      const service = buildService(reporteRepo);

      const result = await service.getStats();

      expect(result.porPlataforma).toEqual([
        { plataforma: 'Mercado Libre', total: 5 },
      ]);
      expect(result.porCategoria).toEqual([
        { categoria: 'Producto no entregado', total: 5 },
      ]);
      expect(result.porEstado).toEqual([{ estado: 'pendiente', total: 5 }]);
      // Últimos 12 meses, rellenos con 0 porque qbMes no devolvió filas.
      expect(result.porMes).toHaveLength(12);
      expect(result.porMes.every((m) => m.total === 0)).toBe(true);
    });
  });

  describe('getReportById (escenario fallido)', () => {
    it('lanza NotFoundException si el reporte no existe', async () => {
      const reporteRepo = { findOne: jest.fn().mockResolvedValue(null) };
      const service = buildService(reporteRepo);

      await expect(service.getReportById(999, 1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
