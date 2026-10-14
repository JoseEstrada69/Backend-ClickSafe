import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AppConfigService } from './../src/config/app-config.service';
import { setupApp } from './../src/setup-app';
import {
  createVerifiedUser,
  raiseAuthThrottleForTests,
  usuarioRepoFrom,
} from './utils/e2e-helpers';

/**
 * PATCH /me/password con `passwordActual` incorrecta (sección 7): 400 con
 * code INVALID_CURRENT_PASSWORD, nunca 401 — un 401 hace que algunos
 * clientes lo confundan con una sesión vencida, refresquen el token y
 * reintenten solo, generando un segundo intento fallido que el usuario
 * nunca hizo. La sesión actual sigue siendo válida después del intento.
 */
describe('PATCH /me/password (e2e) — contraseña actual incorrecta', () => {
  let app: NestExpressApplication;
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
  }, 30_000);

  afterAll(async () => {
    await app.close();
    restoreThrottle();
  });

  it('responde 400 con code INVALID_CURRENT_PASSWORD (no 401), y la sesión actual sigue válida', async () => {
    const usuarioRepo = usuarioRepoFrom(app);
    const user = await createVerifiedUser(app, usuarioRepo);

    const response = await request(app.getHttpServer() as App)
      .patch('/api/v1/me/password')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        passwordActual: 'esta-no-es-la-contraseña-correcta',
        nuevaPassword: 'Xk9#mPq2vL7zT4',
      });

    expect(response.status).toBe(400);
    const body = response.body as { message: string; code?: string };
    expect(body.code).toBe('INVALID_CURRENT_PASSWORD');
    expect(body.message).not.toMatch(/esta-no-es-la-contraseña-correcta/);

    // La misma sesión (el mismo accessToken) sigue funcionando: un intento
    // fallido de PATCH /me/password nunca debe comportarse como si el
    // token hubiera expirado o la sesión se hubiera revocado.
    const stillValid = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${user.accessToken}`);
    expect(stillValid.status).toBe(200);
  }, 30_000);
});
