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
  Comentario,
  Plataforma,
} from './../src/database/entities';
import {
  createVerifiedUser,
  raiseAuthThrottleForTests,
  usuarioRepoFrom,
} from './utils/e2e-helpers';

/**
 * Pruebas de seguridad de comentarios y denuncias (sección 1, reglas 5 y
 * 6): anonimato real y moderación híbrida por umbral.
 */
describe('Comments (e2e) — seguridad', () => {
  let app: NestExpressApplication;
  let comentarioRepo: Repository<Comentario>;
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

    comentarioRepo = app.get<Repository<Comentario>>(
      getRepositoryToken(Comentario),
    );
    const plataformaRepo = app.get<Repository<Plataforma>>(
      getRepositoryToken(Plataforma),
    );
    const categoriaRepo = app.get<Repository<CategoriaFraude>>(
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
  });

  afterAll(async () => {
    await app.close();
    restoreThrottle();
  });

  async function createReport(accessToken: string): Promise<number> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/reports')
      .set('Authorization', `Bearer ${accessToken}`)
      .field('titulo', 'Reporte para pruebas de comentarios')
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

  it('un comentario anónimo no expone ningún dato del autor', async () => {
    const usuarioRepo = usuarioRepoFrom(app);
    const reportOwner = await createVerifiedUser(app, usuarioRepo);
    const commenter = await createVerifiedUser(app, usuarioRepo, {
      nombre: 'Autor Secreto Del Comentario',
    });
    const viewer = await createVerifiedUser(app, usuarioRepo);
    const reportId = await createReport(reportOwner.accessToken);

    const createResponse = await request(app.getHttpServer() as App)
      .post(`/api/v1/reports/${reportId}/comments`)
      .set('Authorization', `Bearer ${commenter.accessToken}`)
      .send({ contenido: 'Comentario anónimo de prueba', anonimo: true });
    expect(createResponse.status).toBe(201);
    expect(JSON.stringify(createResponse.body)).not.toMatch(
      /Autor Secreto Del Comentario/,
    );

    const listResponse = await request(app.getHttpServer())
      .get(`/api/v1/reports/${reportId}/comments`)
      .set('Authorization', `Bearer ${viewer.accessToken}`);
    expect(listResponse.status).toBe(200);
    const body = listResponse.body as {
      items: { autor: unknown; esMio: boolean }[];
    };
    expect(body.items[0].autor).toBeNull();
    expect(body.items[0].esMio).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/Autor Secreto Del Comentario/);
  });

  it('3 denuncias de usuarios distintos ocultan el comentario automáticamente', async () => {
    const usuarioRepo = usuarioRepoFrom(app);
    const reportOwner = await createVerifiedUser(app, usuarioRepo);
    const commenter = await createVerifiedUser(app, usuarioRepo);
    const flagger1 = await createVerifiedUser(app, usuarioRepo);
    const flagger2 = await createVerifiedUser(app, usuarioRepo);
    const flagger3 = await createVerifiedUser(app, usuarioRepo);
    const reportId = await createReport(reportOwner.accessToken);

    const commentResponse = await request(app.getHttpServer() as App)
      .post(`/api/v1/reports/${reportId}/comments`)
      .set('Authorization', `Bearer ${commenter.accessToken}`)
      .send({ contenido: 'Comentario que será denunciado', anonimo: false });
    const commentId = (commentResponse.body as { id: number }).id;

    for (const flagger of [flagger1, flagger2]) {
      const response = await request(app.getHttpServer() as App)
        .post(`/api/v1/comments/${commentId}/flags`)
        .set('Authorization', `Bearer ${flagger.accessToken}`)
        .send({ motivo: 'spam' });
      expect(response.status).toBe(201);
    }

    let comentario = await comentarioRepo.findOne({
      where: { idComentario: commentId },
    });
    expect(comentario?.estado).toBe('visible');

    const thirdFlagResponse = await request(app.getHttpServer() as App)
      .post(`/api/v1/comments/${commentId}/flags`)
      .set('Authorization', `Bearer ${flagger3.accessToken}`)
      .send({ motivo: 'acoso' });
    expect(thirdFlagResponse.status).toBe(201);

    comentario = await comentarioRepo.findOne({
      where: { idComentario: commentId },
    });
    expect(comentario?.estado).toBe('oculto_auto');
    expect(comentario?.totalDenuncias).toBe(3);

    const listResponse = await request(app.getHttpServer())
      .get(`/api/v1/reports/${reportId}/comments`)
      .set('Authorization', `Bearer ${reportOwner.accessToken}`);
    expect(listResponse.status).toBe(200);
    expect((listResponse.body as { total: number }).total).toBe(0);
  });

  it('denunciar el propio comentario responde 403 OWN_COMMENT, y repetir la denuncia responde 409 ALREADY_FLAGGED', async () => {
    const usuarioRepo = usuarioRepoFrom(app);
    const reportOwner = await createVerifiedUser(app, usuarioRepo);
    const commenter = await createVerifiedUser(app, usuarioRepo);
    const flagger = await createVerifiedUser(app, usuarioRepo);
    const reportId = await createReport(reportOwner.accessToken);

    const commentResponse = await request(app.getHttpServer() as App)
      .post(`/api/v1/reports/${reportId}/comments`)
      .set('Authorization', `Bearer ${commenter.accessToken}`)
      .send({ contenido: 'Comentario propio', anonimo: false });
    const commentId = (commentResponse.body as { id: number }).id;

    const ownFlagResponse = await request(app.getHttpServer() as App)
      .post(`/api/v1/comments/${commentId}/flags`)
      .set('Authorization', `Bearer ${commenter.accessToken}`)
      .send({ motivo: 'otro' });
    expect(ownFlagResponse.status).toBe(403);
    expect((ownFlagResponse.body as { code?: string }).code).toBe(
      'OWN_COMMENT',
    );

    const firstFlag = await request(app.getHttpServer() as App)
      .post(`/api/v1/comments/${commentId}/flags`)
      .set('Authorization', `Bearer ${flagger.accessToken}`)
      .send({ motivo: 'spam' });
    expect(firstFlag.status).toBe(201);

    const duplicateFlag = await request(app.getHttpServer() as App)
      .post(`/api/v1/comments/${commentId}/flags`)
      .set('Authorization', `Bearer ${flagger.accessToken}`)
      .send({ motivo: 'spam' });
    expect(duplicateFlag.status).toBe(409);
    expect((duplicateFlag.body as { code?: string }).code).toBe(
      'ALREADY_FLAGGED',
    );
  });
});
