import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import sharp from 'sharp';
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
  createVerifiedUser,
  raiseAuthThrottleForTests,
  usuarioRepoFrom,
} from './utils/e2e-helpers';

/**
 * Pruebas de seguridad de /reports y /evidences (sección 7), no e2e de
 * cada endpoint: control de propiedad (IDOR), operación atómica
 * condicionada a estado, anonimato real, validación real de imágenes,
 * mass assignment, y URLs de evidencias firmadas.
 */
describe('Reports (e2e) — seguridad', () => {
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
  });

  afterAll(async () => {
    await app.close();
    restoreThrottle();
  });

  async function createReport(
    accessToken: string,
    overrides: Partial<{ titulo: string; anonimo: string }> = {},
  ) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/reports')
      .set('Authorization', `Bearer ${accessToken}`)
      .field('titulo', overrides.titulo ?? 'Reporte de prueba de seguridad')
      .field(
        'descripcion',
        'Descripción de prueba con más de veinte caracteres de longitud.',
      )
      .field('urlPublicacion', 'https://tienda-fraude.example.com/producto')
      .field('plataformaId', String(platformId))
      .field('categoriaId', String(categoryId))
      .field('anonimo', overrides.anonimo ?? 'false');
    expect(response.status).toBe(201);
    return response.body as { id: number };
  }

  it('editar o borrar el reporte de otro usuario responde 404 (IDOR)', async () => {
    const usuarioRepo = usuarioRepoFrom(app);
    const owner = await createVerifiedUser(app, usuarioRepo);
    const attacker = await createVerifiedUser(app, usuarioRepo);
    const report = await createReport(owner.accessToken);

    const editResponse = await request(app.getHttpServer() as App)
      .patch(`/api/v1/reports/${report.id}`)
      .set('Authorization', `Bearer ${attacker.accessToken}`)
      .send({ titulo: 'Intento de edición ajena' });
    expect(editResponse.status).toBe(404);

    const deleteResponse = await request(app.getHttpServer())
      .delete(`/api/v1/reports/${report.id}`)
      .set('Authorization', `Bearer ${attacker.accessToken}`);
    expect(deleteResponse.status).toBe(404);

    const stillThere = await reporteRepo.findOne({
      where: { idReporte: report.id },
    });
    expect(stillThere).not.toBeNull();
  });

  it('editar un reporte ya validado responde REPORT_NOT_EDITABLE', async () => {
    const usuarioRepo = usuarioRepoFrom(app);
    const owner = await createVerifiedUser(app, usuarioRepo);
    const report = await createReport(owner.accessToken);

    await reporteRepo.update({ idReporte: report.id }, { estado: 'validado' });

    const response = await request(app.getHttpServer() as App)
      .patch(`/api/v1/reports/${report.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ titulo: 'Intento tras validación' });

    expect(response.status).toBe(400);
    expect((response.body as { code?: string }).code).toBe(
      'REPORT_NOT_EDITABLE',
    );
  });

  it('un reporte anónimo no expone ningún dato del autor', async () => {
    const usuarioRepo = usuarioRepoFrom(app);
    const author = await createVerifiedUser(app, usuarioRepo, {
      nombre: 'Nombre Secreto',
    });
    const viewer = await createVerifiedUser(app, usuarioRepo);
    const report = await createReport(author.accessToken, { anonimo: 'true' });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/reports/${report.id}`)
      .set('Authorization', `Bearer ${viewer.accessToken}`);

    expect(response.status).toBe(200);
    const body = response.body as { autor: unknown; esMio: boolean };
    expect(body.autor).toBeNull();
    expect(body.esMio).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/Nombre Secreto/);
  });

  it('subir un archivo que no es imagen responde INVALID_IMAGE', async () => {
    const usuarioRepo = usuarioRepoFrom(app);
    const user = await createVerifiedUser(app, usuarioRepo);

    const response = await request(app.getHttpServer())
      .post('/api/v1/reports')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .field('titulo', 'Reporte con archivo falso')
      .field(
        'descripcion',
        'Descripción de prueba con más de veinte caracteres de longitud.',
      )
      .field('urlPublicacion', 'https://tienda-fraude.example.com/producto')
      .field('plataformaId', String(platformId))
      .field('categoriaId', String(categoryId))
      .field('anonimo', 'false')
      .attach(
        'evidencias',
        Buffer.from('esto no es una imagen, es texto plano'),
        { filename: 'foto.jpg', contentType: 'image/jpeg' },
      );

    expect(response.status).toBe(400);
    expect((response.body as { code?: string }).code).toBe('INVALID_IMAGE');
  });

  it('un campo extra en el body (estado) responde 400 (mass assignment)', async () => {
    const usuarioRepo = usuarioRepoFrom(app);
    const user = await createVerifiedUser(app, usuarioRepo);

    const response = await request(app.getHttpServer() as App)
      .patch('/api/v1/reports/1')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ titulo: 'x', estado: 'validado', idUsuario: 1, totalLikes: 999 });

    expect(response.status).toBe(400);
  });

  it('una URL de evidencia con firma alterada o expirada responde 403/404', async () => {
    // Firma alterada contra un id cualquiera: nunca debe servir el archivo.
    const tamperedResponse = await request(app.getHttpServer()).get(
      '/api/v1/evidences/1?exp=9999999999&sig=' + '0'.repeat(64),
    );
    expect([403, 404]).toContain(tamperedResponse.status);

    // Firma "expirada" (exp en el pasado) con cualquier valor de sig.
    const expiredResponse = await request(app.getHttpServer()).get(
      '/api/v1/evidences/1?exp=1&sig=' + '1'.repeat(64),
    );
    expect([403, 404]).toContain(expiredResponse.status);
  });

  it('la forma JSON de un reporte no cambió al convertir las interfaces de respuesta a clases (OpenAPI)', async () => {
    const usuarioRepo = usuarioRepoFrom(app);
    const owner = await createVerifiedUser(app, usuarioRepo);
    const report = await createReport(owner.accessToken);

    const response = await request(app.getHttpServer())
      .get(`/api/v1/reports/${report.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(response.status).toBe(200);
    const body = response.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      [
        'id',
        'titulo',
        'descripcion',
        'urlPublicacion',
        'plataforma',
        'plataformaOtra',
        'categoria',
        'estado',
        'anonimo',
        'autor',
        'esMio',
        'likedByMe',
        'totalLikes',
        'totalComentarios',
        'evidencias',
        'revision',
        'fechaCreacion',
        'fechaActualizacion',
      ].sort(),
    );
    expect(Object.keys(body.plataforma as object).sort()).toEqual(
      ['id', 'nombre'].sort(),
    );
    expect(Object.keys(body.categoria as object).sort()).toEqual(
      ['id', 'nombre'].sort(),
    );
    expect(Object.keys(body.autor as object).sort()).toEqual(['nombre']);
  });

  async function buildValidImage(): Promise<Buffer> {
    return sharp({
      create: {
        width: 10,
        height: 10,
        channels: 3,
        background: { r: 200, g: 50, b: 50 },
      },
    })
      .png()
      .toBuffer();
  }

  describe('POST/DELETE /reports/:id/evidences', () => {
    it('agrega una evidencia a un reporte propio pendiente', async () => {
      const usuarioRepo = usuarioRepoFrom(app);
      const owner = await createVerifiedUser(app, usuarioRepo);
      const report = await createReport(owner.accessToken);
      const image = await buildValidImage();

      const response = await request(app.getHttpServer())
        .post(`/api/v1/reports/${report.id}/evidences`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .attach('evidencias', image, {
          filename: 'foto.png',
          contentType: 'image/png',
        });

      expect(response.status).toBe(201);
      const body = response.body as { evidencias: { id: number }[] };
      expect(body.evidencias.length).toBe(1);
    });

    it('agregar evidencias a un reporte ajeno responde 404 (IDOR)', async () => {
      const usuarioRepo = usuarioRepoFrom(app);
      const owner = await createVerifiedUser(app, usuarioRepo);
      const attacker = await createVerifiedUser(app, usuarioRepo);
      const report = await createReport(owner.accessToken);
      const image = await buildValidImage();

      const response = await request(app.getHttpServer())
        .post(`/api/v1/reports/${report.id}/evidences`)
        .set('Authorization', `Bearer ${attacker.accessToken}`)
        .attach('evidencias', image, {
          filename: 'foto.png',
          contentType: 'image/png',
        });

      expect(response.status).toBe(404);
    });

    it('agregar evidencias a un reporte ya revisado responde REPORT_NOT_EDITABLE', async () => {
      const usuarioRepo = usuarioRepoFrom(app);
      const owner = await createVerifiedUser(app, usuarioRepo);
      const report = await createReport(owner.accessToken);
      await reporteRepo.update(
        { idReporte: report.id },
        { estado: 'validado' },
      );
      const image = await buildValidImage();

      const response = await request(app.getHttpServer())
        .post(`/api/v1/reports/${report.id}/evidences`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .attach('evidencias', image, {
          filename: 'foto.png',
          contentType: 'image/png',
        });

      expect(response.status).toBe(400);
      expect((response.body as { code?: string }).code).toBe(
        'REPORT_NOT_EDITABLE',
      );
    });

    it('respeta el máximo de 5 evidencias por reporte (EVIDENCE_LIMIT)', async () => {
      const usuarioRepo = usuarioRepoFrom(app);
      const owner = await createVerifiedUser(app, usuarioRepo);
      const report = await createReport(owner.accessToken);
      const image = await buildValidImage();

      let req = request(app.getHttpServer())
        .post(`/api/v1/reports/${report.id}/evidences`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      for (let i = 0; i < 6; i++) {
        req = req.attach('evidencias', image, {
          filename: `foto${i}.png`,
          contentType: 'image/png',
        });
      }
      const overLimit = await req;

      expect(overLimit.status).toBe(400);
      expect((overLimit.body as { code?: string }).code).toBe('EVIDENCE_LIMIT');
    });

    it('borra una evidencia propia; borrarla de otro usuario responde 404 (IDOR)', async () => {
      const usuarioRepo = usuarioRepoFrom(app);
      const owner = await createVerifiedUser(app, usuarioRepo);
      const attacker = await createVerifiedUser(app, usuarioRepo);
      const report = await createReport(owner.accessToken);
      const image = await buildValidImage();

      const addResponse = await request(app.getHttpServer())
        .post(`/api/v1/reports/${report.id}/evidences`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .attach('evidencias', image, {
          filename: 'foto.png',
          contentType: 'image/png',
        });
      const evidenceId = (addResponse.body as { evidencias: { id: number }[] })
        .evidencias[0].id;

      const attackerDelete = await request(app.getHttpServer())
        .delete(`/api/v1/reports/${report.id}/evidences/${evidenceId}`)
        .set('Authorization', `Bearer ${attacker.accessToken}`);
      expect(attackerDelete.status).toBe(404);

      const ownerDelete = await request(app.getHttpServer())
        .delete(`/api/v1/reports/${report.id}/evidences/${evidenceId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(ownerDelete.status).toBe(204);
    });
  });

  describe('GET /me/reports y GET /me/comments', () => {
    it('lista solo los reportes propios, incluidos los anónimos propios (autor sigue null)', async () => {
      const usuarioRepo = usuarioRepoFrom(app);
      const owner = await createVerifiedUser(app, usuarioRepo);
      const other = await createVerifiedUser(app, usuarioRepo);
      await createReport(owner.accessToken, { titulo: 'Propio visible' });
      await createReport(owner.accessToken, {
        titulo: 'Propio anónimo',
        anonimo: 'true',
      });
      await createReport(other.accessToken, { titulo: 'De otro usuario' });

      const response = await request(app.getHttpServer())
        .get('/api/v1/me/reports')
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(response.status).toBe(200);
      const body = response.body as {
        items: { titulo: string; esMio: boolean; autor: unknown }[];
        total: number;
      };
      expect(body.total).toBe(2);
      expect(body.items.every((r) => r.esMio)).toBe(true);
      const anonimo = body.items.find((r) => r.titulo === 'Propio anónimo');
      expect(anonimo?.autor).toBeNull();
    });

    it('lista solo los comentarios propios, sin los borrados, con el contexto del reporte', async () => {
      const usuarioRepo = usuarioRepoFrom(app);
      const owner = await createVerifiedUser(app, usuarioRepo);
      const other = await createVerifiedUser(app, usuarioRepo);
      const report = await createReport(other.accessToken);

      const keptResponse = await request(app.getHttpServer())
        .post(`/api/v1/reports/${report.id}/comments`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ contenido: 'Comentario propio', anonimo: false });
      const { id: keptId } = keptResponse.body as { id: number };

      const deletedResponse = await request(app.getHttpServer())
        .post(`/api/v1/reports/${report.id}/comments`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ contenido: 'Este se borra', anonimo: false });
      const { id: deletedId } = deletedResponse.body as { id: number };
      await request(app.getHttpServer())
        .delete(`/api/v1/comments/${deletedId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);

      const response = await request(app.getHttpServer())
        .get('/api/v1/me/comments')
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(response.status).toBe(200);
      const body = response.body as {
        items: {
          id: number;
          reporteId: number;
          reporteTitulo: string;
          estado: string;
        }[];
      };
      expect(body.items.some((c) => c.id === deletedId)).toBe(false);
      const own = body.items.find((c) => c.id === keptId);
      expect(own).toBeDefined();
      expect(own?.reporteId).toBe(report.id);
      expect(own?.estado).toBe('visible');
    });
  });
});
