import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EvidenceUrlService } from '../evidences/evidence-url.service';
import { ImageProcessingService } from '../evidences/image-processing.service';
import { ReportsService } from './reports.service';

/**
 * Requisito 4.1.4 del reporte: lectura de datos con escenario exitoso y
 * fallido. getFeed/getById son de solo lectura (GET /reports, GET
 * /reports/:id) — no validan propiedad porque los reportes son públicos
 * para cualquier usuario autenticado (sección 1, regla 1).
 */
describe('ReportsService (lectura)', () => {
  function buildService(reporteRepo: Record<string, unknown>) {
    const noop = { find: jest.fn().mockResolvedValue([]) };
    const evidenceUrlService = {
      buildSignedPath: (id: number) => `/api/v1/evidences/${id}?exp=1&sig=x`,
    } as unknown as EvidenceUrlService;
    const imageProcessing = {} as ImageProcessingService;
    const dataSource = {} as DataSource;

    return new ReportsService(
      dataSource,
      reporteRepo as never,
      noop as never,
      noop as never,
      noop as never,
      noop as never,
      noop as never,
      evidenceUrlService,
      imageProcessing,
      noop as never,
    );
  }

  const baseReporte = {
    idReporte: 1,
    idUsuario: 9,
    idPlataforma: 2,
    plataformaOtra: null,
    idCategoria: 3,
    titulo: 'Título',
    descripcion: 'Descripción de prueba con al menos veinte caracteres.',
    urlPublicacion: 'https://example.com/producto',
    anonimo: false,
    estado: 'pendiente',
    totalLikes: 2,
    fechaCreacion: new Date('2026-01-01T00:00:00.000Z'),
    fechaActualizacion: new Date('2026-01-01T00:00:00.000Z'),
    usuario: { nombre: 'Ana' },
    plataforma: { idPlataforma: 2, nombre: 'Mercado Libre' },
    categoria: { idCategoria: 3, nombre: 'Producto no entregado' },
  };

  describe('getFeed (escenario exitoso)', () => {
    it('devuelve los reportes paginados con los campos esperados', async () => {
      const qbMock = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[baseReporte], 1]),
      };
      const commentCountQbMock = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };
      const reporteRepo = {
        createQueryBuilder: jest.fn().mockReturnValue(qbMock),
        manager: {
          getRepository: jest.fn().mockReturnValue({
            createQueryBuilder: jest.fn().mockReturnValue(commentCountQbMock),
          }),
        },
      };
      const service = buildService(reporteRepo);

      const result = await service.getFeed({ page: 1, limit: 20 }, 9);

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: 1,
        titulo: 'Título',
        esMio: true,
        autor: { nombre: 'Ana' },
        totalLikes: 2,
      });
    });
  });

  describe('getById (escenario fallido)', () => {
    it('lanza NotFoundException si el reporte no existe', async () => {
      const reporteRepo = { findOne: jest.fn().mockResolvedValue(null) };
      const service = buildService(reporteRepo);

      await expect(service.getById(999, 9)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
