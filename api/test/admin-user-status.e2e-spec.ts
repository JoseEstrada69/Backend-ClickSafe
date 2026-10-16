import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { AppConfigService } from './../src/config/app-config.service';
import { setupApp } from './../src/setup-app';
import { BitacoraAuditoria } from './../src/database/entities';
import {
  createVerifiedAdmin,
  createVerifiedUser,
  generateTotpCode,
  raiseAuthThrottleForTests,
  solveCaptcha,
  usuarioRepoFrom,
} from './utils/e2e-helpers';

/**
 * PATCH /admin/users/:id/status (sección 7): autosuspensión bloqueada,
 * revocación real de sesiones al suspender a otro admin, y control de
 * acceso. La regla de "no dejar el sistema sin admins activos" NO tiene
 * una prueba dedicada aquí — ver la nota en el primer test.
 */
describe('Admin (e2e) — estado de usuarios', () => {
  let app: NestExpressApplication;
  let bitacoraRepo: Repository<BitacoraAuditoria>;
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

    bitacoraRepo = app.get<Repository<BitacoraAuditoria>>(
      getRepositoryToken(BitacoraAuditoria),
    );
  }, 30_000);

  afterAll(async () => {
    await app.close();
    restoreThrottle();
  });

  /**
   * Un admin que intenta suspenderse a sí mismo siempre cae en el primer
   * chequeo (`idUsuario === adminId`), sin importar cuántos admins activos
   * haya: no llega nunca a contar admins activos. Y al suspender a OTRO
   * admin, para que ese chequeo de conteo (`activeAdmins <= 1`) se alcance
   * se necesita que el objetivo sea admin y esté activo — pero entonces,
   * por construcción, el que llama (admin activo, exigido por el guard) Y
   * el objetivo (admin activo) ya son 2 admins activos distintos, así que
   * `activeAdmins <= 1` nunca puede ser verdad en ese camino. Con las
   * validaciones actuales (RolesGuard + JwtAuthGuard revisando `activo` en
   * cada petición), esa regla es inalcanzable desde la API: queda como
   * defensa en profundidad (p. ej. si alguna vez se quita el chequeo de
   * autosuspensión) y no se prueba, en vez de fingir una cobertura que no
   * existe.
   */
  it('un admin no puede suspenderse a sí mismo (400)', async () => {
    const usuarioRepo = usuarioRepoFrom(app);
    const admin = await createVerifiedAdmin(app, usuarioRepo);

    const response = await request(app.getHttpServer() as App)
      .patch(`/api/v1/admin/users/${admin.idUsuario}/status`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ activo: false });

    expect(response.status).toBe(400);
    const body = response.body as { message: string; code?: string };
    expect(body.message).toBe('No puedes cambiar tu propio estado.');
    expect(body.code).toBe('OWN_STATUS');
  });

  it('un admin (A) suspende a otro admin (B): B queda inactivo, sus sesiones se revocan y se audita usuario_suspendido', async () => {
    const usuarioRepo = usuarioRepoFrom(app);
    const admin = await createVerifiedAdmin(app, usuarioRepo);
    const targetPassword = 'Bq7!wNt2cV5yH1Ze';
    const target = await createVerifiedAdmin(app, usuarioRepo, {
      password: targetPassword,
    });

    // Sesión propia de B (distinta a la que createVerifiedAdmin ya usó
    // internamente) para poder comprobar que accessToken Y refreshToken
    // dejan de servir después de la suspensión.
    await usuarioRepo.update(target.idUsuario, { totpUltimoContador: null });
    const loginCaptcha = await solveCaptcha(app);
    const loginResponse = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({
        correo: target.correo,
        password: targetPassword,
        captcha: loginCaptcha,
      });
    expect(loginResponse.status).toBe(200);
    const { mfaToken } = loginResponse.body as { mfaToken: string };
    const verifyResponse = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/2fa/verify')
      .send({ mfaToken, codigo: generateTotpCode(target.totpSecret, 0) });
    expect(verifyResponse.status).toBe(200);
    const { accessToken: targetAccessToken, refreshToken: targetRefreshToken } =
      verifyResponse.body as { accessToken: string; refreshToken: string };

    // Confirma que la sesión de B funciona ANTES de que A la suspenda.
    const beforeSuspend = await request(app.getHttpServer())
      .get('/api/v1/admin/stats')
      .set('Authorization', `Bearer ${targetAccessToken}`);
    expect(beforeSuspend.status).toBe(200);

    const suspendResponse = await request(app.getHttpServer() as App)
      .patch(`/api/v1/admin/users/${target.idUsuario}/status`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ activo: false });
    expect(suspendResponse.status).toBe(204);

    const updated = await usuarioRepo.findOne({
      where: { idUsuario: target.idUsuario },
    });
    expect(updated?.activo).toBe(false);

    const afterSuspendAccess = await request(app.getHttpServer())
      .get('/api/v1/admin/stats')
      .set('Authorization', `Bearer ${targetAccessToken}`);
    expect(afterSuspendAccess.status).toBe(401);

    const afterSuspendRefresh = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: targetRefreshToken });
    expect(afterSuspendRefresh.status).toBe(401);

    const auditRow = await bitacoraRepo.findOne({
      where: { idUsuario: admin.idUsuario, accion: 'usuario_suspendido' },
      order: { idEvento: 'DESC' },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow?.resultado).toBe('exito');
    expect(auditRow?.recursoTipo).toBe('Usuario');
    expect(auditRow?.recursoId).toBe(target.idUsuario);
    expect(auditRow?.ip).not.toBeNull();
  }, 30_000);

  it('un usuario normal no puede llamar a este endpoint (403)', async () => {
    const usuarioRepo = usuarioRepoFrom(app);
    const normalUser = await createVerifiedUser(app, usuarioRepo);
    const someAdmin = await createVerifiedAdmin(app, usuarioRepo);

    const response = await request(app.getHttpServer() as App)
      .patch(`/api/v1/admin/users/${someAdmin.idUsuario}/status`)
      .set('Authorization', `Bearer ${normalUser.accessToken}`)
      .send({ activo: false });

    expect(response.status).toBe(403);
  }, 30_000);
});
