import { Repository } from 'typeorm';
import { CategoriaFraude, Plataforma } from '../database/entities';
import { CatalogsService } from './catalogs.service';

/**
 * Requisito del reporte (Fase 7): lectura de datos con escenario exitoso y
 * fallido. GET /platforms y /categories solo devuelven catálogos activos
 * (sección 1, regla 10) -- el filtro vive en el `where` que se le pasa al
 * repositorio, así que lo confirmamos ahí en vez de fingir una excepción
 * que este servicio nunca lanza.
 */
describe('CatalogsService (lectura)', () => {
  function buildService(
    plataformaRepo: Record<string, unknown>,
    categoriaRepo: Record<string, unknown>,
  ): CatalogsService {
    return new CatalogsService(
      plataformaRepo as unknown as Repository<Plataforma>,
      categoriaRepo as unknown as Repository<CategoriaFraude>,
    );
  }

  describe('listPlatforms (escenario exitoso)', () => {
    it('devuelve las plataformas activas mapeadas a la forma pública', async () => {
      const find = jest.fn().mockResolvedValue([
        {
          idPlataforma: 1,
          nombre: 'Mercado Libre',
          esOtra: false,
          activa: true,
        },
        { idPlataforma: 2, nombre: 'Otra', esOtra: true, activa: true },
      ]);
      const service = buildService({ find }, { find: jest.fn() });

      const result = await service.listPlatforms();

      expect(find).toHaveBeenCalledWith({
        where: { activa: true },
        order: { nombre: 'ASC' },
      });
      expect(result).toEqual([
        { id: 1, nombre: 'Mercado Libre', esOtra: false },
        { id: 2, nombre: 'Otra', esOtra: true },
      ]);
    });
  });

  describe('listCategories (escenario fallido: sin categorías activas)', () => {
    it('devuelve un arreglo vacío si no hay ninguna categoría activa', async () => {
      const find = jest.fn().mockResolvedValue([]);
      const service = buildService({ find: jest.fn() }, { find });

      const result = await service.listCategories();

      expect(find).toHaveBeenCalledWith({
        where: { activa: true },
        order: { nombre: 'ASC' },
      });
      expect(result).toEqual([]);
    });
  });
});
