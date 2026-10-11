import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
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
});
