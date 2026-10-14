import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AppConfigService } from './../src/config/app-config.service';
import { setupApp } from './../src/setup-app';
import {
  TestUser,
  createVerifiedAdmin,
  createVerifiedUser,
  raiseAuthThrottleForTests,
  usuarioRepoFrom,
} from './utils/e2e-helpers';

/**
 * Control de acceso de /admin/* (sección 4.3): deny-by-default + rol +
 * 2FA. No es e2e de cada endpoint — solo confirma que un usuario normal
 * (incluso con sesión válida) nunca pasa el RolesGuard.
 */
describe('Admin (e2e) — control de acceso', () => {
  let app: NestExpressApplication;
  let normalUser: TestUser;
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

    const usuarioRepo = usuarioRepoFrom(app);
    normalUser = await createVerifiedUser(app, usuarioRepo);
  }, 30_000);

  afterAll(async () => {
    await app.close();
    restoreThrottle();
  });

  it.each([
    ['GET', '/api/v1/admin/reports'],
    ['GET', '/api/v1/admin/reports/1'],
    ['GET', '/api/v1/admin/users'],
    ['GET', '/api/v1/admin/stats'],
    ['GET', '/api/v1/admin/audit-log'],
    ['GET', '/api/v1/admin/comments/flagged'],
  ])('%s %s con usuario normal responde 403', async (method, path) => {
    const response = await request(app.getHttpServer())
      [method === 'GET' ? 'get' : 'post'](path)
      .set('Authorization', `Bearer ${normalUser.accessToken}`);
    expect(response.status).toBe(403);
  });

  it('un admin real (rol + 2FA completado) sí puede entrar a /admin/*', async () => {
    const usuarioRepo = usuarioRepoFrom(app);
    const admin = await createVerifiedAdmin(app, usuarioRepo);

    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/stats')
      .set('Authorization', `Bearer ${admin.accessToken}`);
    expect(response.status).toBe(200);
  }, 30_000);
});
