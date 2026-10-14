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
  Comentario,
  Notificacion,
  Plataforma,
} from './../src/database/entities';
import {
  createVerifiedAdmin,
  createVerifiedUser,
  raiseAuthThrottleForTests,
  usuarioRepoFrom,
} from './utils/e2e-helpers';

/**
 * GET /admin/comments/flagged > denuncias[] y PATCH /admin/comments/:id
 * (sección 1 regla 6, sección 7): anonimato de quien denuncia, y la
 * condición atómica "en moderación" que evita moderar dos veces.
 */
describe('Admin (e2e) — moderación de comentarios', () => {
  let app: NestExpressApplication;
  let comentarioRepo: Repository<Comentario>;
  let notificacionRepo: Repository<Notificacion>;
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
    notificacionRepo = app.get<Repository<Notificacion>>(
      getRepositoryToken(Notificacion),
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
  }, 30_000);

  afterAll(async () => {
    await app.close();
    restoreThrottle();
  });

  async function createReport(accessToken: string): Promise<number> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/reports')
      .set('Authorization', `Bearer ${accessToken}`)
      .field('titulo', 'Reporte para pruebas de moderación')
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

  async function createComment(
    reportId: number,
    accessToken: string,
  ): Promise<number> {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/reports/${reportId}/comments`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        contenido: 'Comentario de prueba de moderación',
        anonimo: false,
      });
    expect(response.status).toBe(201);
    return (response.body as { id: number }).id;
  }

  async function flagComment(
    commentId: number,
    accessToken: string,
    motivo: string,
    detalle?: string,
  ): Promise<void> {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/comments/${commentId}/flags`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(detalle ? { motivo, detalle } : { motivo });
    expect(response.status).toBe(201);
  }

  it('GET /admin/comments/flagged incluye denuncias[] con motivo/detalle/fecha, sin ningún dato de quién denunció', async () => {
    const usuarioRepo = usuarioRepoFrom(app);
    const admin = await createVerifiedAdmin(app, usuarioRepo);
    const reportOwner = await createVerifiedUser(app, usuarioRepo);
    const commenter = await createVerifiedUser(app, usuarioRepo);
    const flagger1 = await createVerifiedUser(app, usuarioRepo, {
      nombre: 'Denunciante Uno Secreto',
    });
    const flagger2 = await createVerifiedUser(app, usuarioRepo, {
      nombre: 'Denunciante Dos Secreto',
    });
    const flagger3 = await createVerifiedUser(app, usuarioRepo, {
      nombre: 'Denunciante Tres Secreto',
    });

    const reportId = await createReport(reportOwner.accessToken);
    const commentId = await createComment(reportId, commenter.accessToken);

    await flagComment(commentId, flagger1.accessToken, 'spam', 'Es spam.');
    await flagComment(commentId, flagger2.accessToken, 'acoso', 'Es acoso.');
    await flagComment(
      commentId,
      flagger3.accessToken,
      'informacion_personal',
      'Comparte datos personales.',
    );

    const comentario = await comentarioRepo.findOne({
      where: { idComentario: commentId },
    });
    expect(comentario?.estado).toBe('oculto_auto');

    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/comments/flagged')
      .set('Authorization', `Bearer ${admin.accessToken}`);
    expect(response.status).toBe(200);

    const body = response.body as {
      id: number;
      denuncias: { motivo: string; detalle: string | null; fecha: string }[];
    }[];
    const entry = body.find((c) => c.id === commentId);
    expect(entry).toBeDefined();
    expect(entry!.denuncias).toHaveLength(3);

    const motivos = entry!.denuncias.map((d) => d.motivo).sort();
    expect(motivos).toEqual(['acoso', 'informacion_personal', 'spam']);
    for (const denuncia of entry!.denuncias) {
      expect(typeof denuncia.fecha).toBe('string');
      expect(Object.keys(denuncia).sort()).toEqual(
        ['detalle', 'fecha', 'motivo'].sort(),
      );
    }
    const raw = JSON.stringify(entry);
    expect(raw).not.toMatch(/Secreto/);
  }, 30_000);

  it('moderar un comentario que nunca estuvo en la cola responde 409 COMMENT_NOT_FLAGGED y no cambia nada', async () => {
    const usuarioRepo = usuarioRepoFrom(app);
    const admin = await createVerifiedAdmin(app, usuarioRepo);
    const reportOwner = await createVerifiedUser(app, usuarioRepo);
    const commenter = await createVerifiedUser(app, usuarioRepo);
    const reportId = await createReport(reportOwner.accessToken);
    const commentId = await createComment(reportId, commenter.accessToken);

    const response = await request(app.getHttpServer())
      .patch(`/api/v1/admin/comments/${commentId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ accion: 'confirmar' });

    expect(response.status).toBe(409);
    expect((response.body as { code?: string }).code).toBe(
      'COMMENT_NOT_FLAGGED',
    );

    const sinCambios = await comentarioRepo.findOne({
      where: { idComentario: commentId },
    });
    expect(sinCambios?.estado).toBe('visible');
    expect(sinCambios?.idModerador).toBeNull();

    const notificaciones = await notificacionRepo.count({
      where: { idUsuario: commenter.idUsuario, tipo: 'comentario_ocultado' },
    });
    expect(notificaciones).toBe(0);
  }, 30_000);

  it('moderar el mismo comentario dos veces a la vez: solo una aplica, la otra responde 409 y no hay una segunda notificación', async () => {
    const usuarioRepo = usuarioRepoFrom(app);
    const admin = await createVerifiedAdmin(app, usuarioRepo);
    const reportOwner = await createVerifiedUser(app, usuarioRepo);
    const commenter = await createVerifiedUser(app, usuarioRepo);
    const flagger1 = await createVerifiedUser(app, usuarioRepo);
    const flagger2 = await createVerifiedUser(app, usuarioRepo);
    const flagger3 = await createVerifiedUser(app, usuarioRepo);

    const reportId = await createReport(reportOwner.accessToken);
    const commentId = await createComment(reportId, commenter.accessToken);
    await flagComment(commentId, flagger1.accessToken, 'spam');
    await flagComment(commentId, flagger2.accessToken, 'acoso');
    await flagComment(commentId, flagger3.accessToken, 'otro');

    const comentario = await comentarioRepo.findOne({
      where: { idComentario: commentId },
    });
    expect(comentario?.estado).toBe('oculto_auto');

    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .patch(`/api/v1/admin/comments/${commentId}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ accion: 'confirmar' }),
      request(app.getHttpServer())
        .patch(`/api/v1/admin/comments/${commentId}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ accion: 'confirmar' }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([204, 409]);
    const conflictResponse = first.status === 409 ? first : second;
    expect((conflictResponse.body as { code?: string }).code).toBe(
      'COMMENT_NOT_FLAGGED',
    );

    const notificaciones = await notificacionRepo.count({
      where: { idUsuario: commenter.idUsuario, tipo: 'comentario_ocultado' },
    });
    expect(notificaciones).toBe(1);
  }, 30_000);
});
