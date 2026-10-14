import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import sharp from 'sharp';
import { Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { AppConfigService } from './../src/config/app-config.service';
import { setupApp } from './../src/setup-app';
import {
  CategoriaFraude,
  Plataforma,
  RevisionReporte,
} from './../src/database/entities';
import {
  createVerifiedAdmin,
  createVerifiedUser,
  raiseAuthThrottleForTests,
  usuarioRepoFrom,
} from './utils/e2e-helpers';

/** GET /admin/reports/:id (sección 7): autor real, evidencias firmadas, revisión y esMio. */
describe('Admin (e2e) — detalle de reporte', () => {
  let app: NestExpressApplication;
  let plataformaRepo: Repository<Plataforma>;
  let categoriaRepo: Repository<CategoriaFraude>;
  let revisionRepo: Repository<RevisionReporte>;
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
    revisionRepo = app.get<Repository<RevisionReporte>>(
      getRepositoryToken(RevisionReporte),
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

  async function buildValidImage(): Promise<Buffer> {
    return sharp({
      create: {
        width: 10,
        height: 10,
        channels: 3,
        background: { r: 10, g: 200, b: 10 },
      },
    })
      .png()
      .toBuffer();
  }

  async function createReport(
    accessToken: string,
    overrides: Partial<{ anonimo: string; withEvidence: boolean }> = {},
  ): Promise<number> {
    let req = request(app.getHttpServer())
      .post('/api/v1/reports')
      .set('Authorization', `Bearer ${accessToken}`)
      .field('titulo', 'Reporte para detalle de admin')
      .field(
        'descripcion',
        'Descripción de prueba con más de veinte caracteres de longitud.',
      )
      .field('urlPublicacion', 'https://tienda-fraude.example.com/producto')
      .field('plataformaId', String(platformId))
      .field('categoriaId', String(categoryId))
      .field('anonimo', overrides.anonimo ?? 'false');
    if (overrides.withEvidence) {
      req = req.attach('evidencias', await buildValidImage(), {
        filename: 'foto.png',
        contentType: 'image/png',
      });
    }
    const response = await req;
    expect(response.status).toBe(201);
    return (response.body as { id: number }).id;
  }

  it('trae el autor real y evidencias firmadas aunque el reporte sea anónimo, con revision null si está pendiente', async () => {
    const usuarioRepo = usuarioRepoFrom(app);
    const admin = await createVerifiedAdmin(app, usuarioRepo);
    const author = await createVerifiedUser(app, usuarioRepo, {
      nombre: 'Autor Real De Prueba',
    });
    const reportId = await createReport(author.accessToken, {
      anonimo: 'true',
      withEvidence: true,
    });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/admin/reports/${reportId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(response.status).toBe(200);
    const body = response.body as {
      anonimo: boolean;
      autor: { nombre: string; correo: string };
      evidencias: { id: number; url: string }[];
      revision: unknown;
      esMio: boolean;
    };
    expect(body.anonimo).toBe(true);
    expect(body.autor.nombre).toBe('Autor Real De Prueba');
    expect(body.autor.correo).toBe(author.correo);
    expect(body.evidencias).toHaveLength(1);
    expect(body.evidencias[0].url).toMatch(
      /^\/api\/v1\/evidences\/\d+\?exp=\d+&sig=[0-9a-f]{64}$/,
    );
    expect(body.revision).toBeNull();
    expect(body.esMio).toBe(false);
  }, 30_000);

  it('incluye la revisión más reciente cuando el reporte ya fue revisado', async () => {
    const usuarioRepo = usuarioRepoFrom(app);
    const admin = await createVerifiedAdmin(app, usuarioRepo);
    const reviewer = await createVerifiedAdmin(app, usuarioRepo);
    const author = await createVerifiedUser(app, usuarioRepo);
    const reportId = await createReport(author.accessToken);

    await revisionRepo.save(
      revisionRepo.create({
        idReporte: reportId,
        idAdministrador: reviewer.idUsuario,
        decision: 'validado',
        comentario: 'Todo en orden.',
      }),
    );

    const response = await request(app.getHttpServer())
      .get(`/api/v1/admin/reports/${reportId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(response.status).toBe(200);
    const body = response.body as {
      revision: {
        decision: string;
        comentario: string | null;
        fecha: string;
      } | null;
    };
    expect(body.revision).not.toBeNull();
    expect(body.revision?.decision).toBe('validado');
    expect(body.revision?.comentario).toBe('Todo en orden.');
    expect(typeof body.revision?.fecha).toBe('string');
  }, 30_000);

  it('esMio es true cuando el propio admin es el autor del reporte', async () => {
    const usuarioRepo = usuarioRepoFrom(app);
    const admin = await createVerifiedAdmin(app, usuarioRepo);
    const reportId = await createReport(admin.accessToken);

    const response = await request(app.getHttpServer())
      .get(`/api/v1/admin/reports/${reportId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(response.status).toBe(200);
    const body = response.body as { esMio: boolean };
    expect(body.esMio).toBe(true);
  }, 30_000);

  it('totalComentarios cuenta solo los comentarios visibles, igual que el detalle público', async () => {
    const usuarioRepo = usuarioRepoFrom(app);
    const admin = await createVerifiedAdmin(app, usuarioRepo);
    const author = await createVerifiedUser(app, usuarioRepo);
    const commenter = await createVerifiedUser(app, usuarioRepo);
    const reportId = await createReport(author.accessToken);

    const kept = await request(app.getHttpServer())
      .post(`/api/v1/reports/${reportId}/comments`)
      .set('Authorization', `Bearer ${commenter.accessToken}`)
      .send({ contenido: 'Comentario que se queda visible', anonimo: false });
    expect(kept.status).toBe(201);

    const deleted = await request(app.getHttpServer())
      .post(`/api/v1/reports/${reportId}/comments`)
      .set('Authorization', `Bearer ${commenter.accessToken}`)
      .send({ contenido: 'Comentario que se borra', anonimo: false });
    expect(deleted.status).toBe(201);
    const { id: deletedId } = deleted.body as { id: number };
    await request(app.getHttpServer())
      .delete(`/api/v1/comments/${deletedId}`)
      .set('Authorization', `Bearer ${commenter.accessToken}`);

    const response = await request(app.getHttpServer())
      .get(`/api/v1/admin/reports/${reportId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(response.status).toBe(200);
    expect(
      (response.body as { totalComentarios: number }).totalComentarios,
    ).toBe(1);
  }, 30_000);

  it('un id inexistente responde 404', async () => {
    const usuarioRepo = usuarioRepoFrom(app);
    const admin = await createVerifiedAdmin(app, usuarioRepo);

    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/reports/999999999')
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(response.status).toBe(404);
  }, 30_000);
});
