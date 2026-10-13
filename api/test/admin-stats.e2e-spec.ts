import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { AppConfigService } from './../src/config/app-config.service';
import { setupApp } from './../src/setup-app';
import {
  CategoriaFraude,
  Plataforma,
  Reporte,
} from './../src/database/entities';
import {
  createVerifiedAdmin,
  createVerifiedUser,
  raiseAuthThrottleForTests,
  usuarioRepoFrom,
} from './utils/e2e-helpers';

/** GET /admin/stats > porMes (sección 1 regla 11): últimos 12 meses en UTC, incluidos los meses sin reportes. */
describe('Admin (e2e) — estadísticas por mes', () => {
  let app: NestExpressApplication;
  let plataformaRepo: Repository<Plataforma>;
  let categoriaRepo: Repository<CategoriaFraude>;
  let reporteRepo: Repository<Reporte>;
  let platformId: number;
  let categoryId: number;
  let restoreThrottle: () => void;

  beforeAll(async () => {
    restoreThrottle = raiseAuthThrottleForTests();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    setupApp(app, app.get(AppConfigService));
    await app.init();

    plataformaRepo = app.get<Repository<Plataforma>>(
      getRepositoryToken(Plataforma),
    );
    categoriaRepo = app.get<Repository<CategoriaFraude>>(
      getRepositoryToken(CategoriaFraude),
    );
    reporteRepo = app.get<Repository<Reporte>>(getRepositoryToken(Reporte));

    const plataforma = await plataformaRepo.findOne({
      where: { esOtra: false, activa: true },
    });
    const categoria = await categoriaRepo.findOne({ where: { activa: true } });
    if (!plataforma || !categoria) {
      throw new Error('Faltan catálogos activos para la prueba.');
    }
    platformId = plataforma.idPlataforma;
    categoryId = categoria.idCategoria;
  }, 30_000);

  afterAll(async () => {
    await app.close();
    restoreThrottle();
  });

  async function createReport(accessToken: string): Promise<number> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/reports')
      .set('Authorization', `Bearer ${accessToken}`)
      .field('titulo', 'Reporte para estadísticas por mes')
      .field(
        'descripcion',
        'Descripción de prueba con más de veinte caracteres de longitud.',
      )
      .field('urlPublicacion', 'https://tienda-fraude.example.com/producto')
      .field('plataformaId', String(platformId))
      .field('categoriaId', String(categoryId))
      .field('anonimo', 'false');
    expect(response.status).toBe(201);
    return (response.body as { id: number }).id;
  }

  /** "YYYY-MM" del mes actual en UTC, igual que el formato que debe usar porMes. */
  function currentUtcMonth(): string {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  it('incluye los últimos 12 meses en UTC, en orden cronológico, con el formato "YYYY-MM"', async () => {
    const usuarioRepo = usuarioRepoFrom(app);
    const admin = await createVerifiedAdmin(app, usuarioRepo);

    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/stats')
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(response.status).toBe(200);
    const body = response.body as {
      porMes: { mes: string; total: number }[];
    };
    expect(body.porMes).toHaveLength(12);
    for (const entry of body.porMes) {
      expect(entry.mes).toMatch(/^\d{4}-\d{2}$/);
      expect(typeof entry.total).toBe('number');
    }

    // Cronológico: cada mes es exactamente un mes después del anterior.
    for (let i = 1; i < body.porMes.length; i++) {
      const [prevY, prevM] = body.porMes[i - 1].mes.split('-').map(Number);
      const [curY, curM] = body.porMes[i].mes.split('-').map(Number);
      const prevIndex = prevY * 12 + (prevM - 1);
      const curIndex = curY * 12 + (curM - 1);
      expect(curIndex - prevIndex).toBe(1);
    }

    expect(body.porMes[body.porMes.length - 1].mes).toBe(currentUtcMonth());
  }, 30_000);

  it('un reporte creado hace 6 meses (UTC) suma en el mes correcto, no en el actual', async () => {
    const usuarioRepo = usuarioRepoFrom(app);
    const admin = await createVerifiedAdmin(app, usuarioRepo);
    const author = await createVerifiedUser(app, usuarioRepo);
    const reportId = await createReport(author.accessToken);

    const now = new Date();
    const seisMesesAtras = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 6, 15, 12),
    );
    await reporteRepo.update(
      { idReporte: reportId },
      { fechaCreacion: seisMesesAtras },
    );
    const mesEsperado = `${seisMesesAtras.getUTCFullYear()}-${String(
      seisMesesAtras.getUTCMonth() + 1,
    ).padStart(2, '0')}`;

    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/stats')
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(response.status).toBe(200);
    const body = response.body as {
      porMes: { mes: string; total: number }[];
    };
    const bucket = body.porMes.find((entry) => entry.mes === mesEsperado);
    expect(bucket).toBeDefined();
    expect(bucket!.total).toBeGreaterThanOrEqual(1);
  }, 30_000);
});
