import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { AppConfigService } from './../src/config/app-config.service';
import { setupApp } from './../src/setup-app';
import { CategoriaFraude, Plataforma } from './../src/database/entities';
import {
  createVerifiedAdmin,
  createVerifiedUser,
  raiseAuthThrottleForTests,
  usuarioRepoFrom,
} from './utils/e2e-helpers';

/** GET /admin/reports?estado=... (sección 7): por defecto solo pendientes; `todos` quita el filtro. */
describe('Admin (e2e) — cola de reportes por estado', () => {
  let app: NestExpressApplication;
  let plataformaRepo: Repository<Plataforma>;
  let categoriaRepo: Repository<CategoriaFraude>;
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

  async function createReport(
    accessToken: string,
    titulo: string,
  ): Promise<number> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/reports')
      .set('Authorization', `Bearer ${accessToken}`)
      .field('titulo', titulo)
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

  /** `total` del endpoint (no `items`): la base de e2e es compartida y acumula reportes de otras pruebas, así que page 1 de una lista ordenada por fecha nunca es un lugar confiable para buscar un id específico — `total` sí lo es, porque cuenta sin paginar. */
  async function totalFor(
    accessToken: string,
    estado?: string,
  ): Promise<number> {
    const qs = estado ? `?estado=${estado}&limit=1` : '?limit=1';
    const response = await request(app.getHttpServer())
      .get(`/api/v1/admin/reports${qs}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(response.status).toBe(200);
    return (response.body as { total: number }).total;
  }

  it('sin estado solo cuenta pendientes; estado=todos quita el filtro (pendiente+validado+rechazado); estado inválido responde 400', async () => {
    const usuarioRepo = usuarioRepoFrom(app);
    const admin = await createVerifiedAdmin(app, usuarioRepo);
    const author = await createVerifiedUser(app, usuarioRepo);

    const pendienteAntes = await totalFor(admin.accessToken, 'pendiente');
    const validadoAntes = await totalFor(admin.accessToken, 'validado');
    const rechazadoAntes = await totalFor(admin.accessToken, 'rechazado');

    const pendienteId = await createReport(
      author.accessToken,
      `Cola E2E pendiente ${Date.now()}`,
    );
    const validadoId = await createReport(
      author.accessToken,
      `Cola E2E validado ${Date.now()}`,
    );
    const rechazadoId = await createReport(
      author.accessToken,
      `Cola E2E rechazado ${Date.now()}`,
    );

    const reviewValidado = await request(app.getHttpServer())
      .post(`/api/v1/admin/reports/${validadoId}/review`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ decision: 'validado' });
    expect(reviewValidado.status).toBe(200);

    const reviewRechazado = await request(app.getHttpServer())
      .post(`/api/v1/admin/reports/${rechazadoId}/review`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ decision: 'rechazado' });
    expect(reviewRechazado.status).toBe(200);

    // Cada reporte terminó en el estado correcto (confirmado por el detalle,
    // que no depende de paginación): esto es lo que realmente demuestra que
    // mis 3 reportes existen y están donde deben, antes de mirar la cola.
    const detallePendiente = await request(app.getHttpServer())
      .get(`/api/v1/admin/reports/${pendienteId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`);
    const detalleValidado = await request(app.getHttpServer())
      .get(`/api/v1/admin/reports/${validadoId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`);
    const detalleRechazado = await request(app.getHttpServer())
      .get(`/api/v1/admin/reports/${rechazadoId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`);
    expect((detallePendiente.body as { estado: string }).estado).toBe(
      'pendiente',
    );
    expect((detalleValidado.body as { estado: string }).estado).toBe(
      'validado',
    );
    expect((detalleRechazado.body as { estado: string }).estado).toBe(
      'rechazado',
    );

    // En paralelo (no secuencial): minimiza la ventana en la que otra
    // prueba, corriendo al mismo tiempo en la misma base compartida, podría
    // crear o revisar un reporte entre una lectura y la siguiente y romper
    // la igualdad de abajo.
    const [
      pendienteDespues,
      validadoDespues,
      rechazadoDespues,
      defaultDespues,
      todosDespues,
    ] = await Promise.all([
      totalFor(admin.accessToken, 'pendiente'),
      totalFor(admin.accessToken, 'validado'),
      totalFor(admin.accessToken, 'rechazado'),
      totalFor(admin.accessToken), // sin `estado`
      totalFor(admin.accessToken, 'todos'),
    ]);

    // Las otras pruebas e2e que corren en paralelo también crean reportes
    // en esta misma base, así que se compara con "al menos +1", no con una
    // igualdad exacta.
    expect(pendienteDespues).toBeGreaterThanOrEqual(pendienteAntes + 1);
    expect(validadoDespues).toBeGreaterThanOrEqual(validadoAntes + 1);
    expect(rechazadoDespues).toBeGreaterThanOrEqual(rechazadoAntes + 1);

    // Sin `estado` se comporta igual que `estado=pendiente` explícito (el
    // default no cambió).
    expect(defaultDespues).toBe(pendienteDespues);

    // estado=todos quita el filtro por completo: su total es la suma exacta
    // de los 3 estados, sin importar cuántos reportes haya acumulado la
    // base de pruebas compartida.
    expect(todosDespues).toBe(
      pendienteDespues + validadoDespues + rechazadoDespues,
    );

    // Cualquier otro valor: 400 (lista blanca, 4.7).
    const invalidResponse = await request(app.getHttpServer())
      .get('/api/v1/admin/reports?estado=basura')
      .set('Authorization', `Bearer ${admin.accessToken}`);
    expect(invalidResponse.status).toBe(400);
  }, 30_000);
});
