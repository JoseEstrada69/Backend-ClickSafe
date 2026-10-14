import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AppConfigService } from './../src/config/app-config.service';
import { setupApp } from './../src/setup-app';
import {
  createVerifiedAdmin,
  raiseAuthThrottleForTests,
  solveCaptcha,
  usuarioRepoFrom,
} from './utils/e2e-helpers';

/** GET /admin/audit-log > usuario (sección 7): {nombre, correo} resuelto desde la fila, o null si el evento no tiene usuario asociado. */
describe('Admin (e2e) — bitácora con usuario', () => {
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

  it('una fila con usuario conocido trae { nombre, correo }', async () => {
    const usuarioRepo = usuarioRepoFrom(app);
    const admin = await createVerifiedAdmin(app, usuarioRepo, {
      nombre: 'Admin Con Bitácora',
    });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/admin/audit-log?usuario=${admin.idUsuario}`)
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(response.status).toBe(200);
    const body = response.body as {
      items: {
        idUsuario: number | null;
        usuario: { nombre: string; correo: string } | null;
      }[];
    };
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) {
      expect(item.idUsuario).toBe(admin.idUsuario);
      expect(item.usuario).toEqual({
        nombre: 'Admin Con Bitácora',
        correo: admin.correo,
      });
    }
  }, 30_000);

  it('un evento sin usuario asociado (login con correo inexistente) trae usuario: null', async () => {
    const usuarioRepo = usuarioRepoFrom(app);
    const admin = await createVerifiedAdmin(app, usuarioRepo);

    const captcha = await solveCaptcha(app);
    const failedLogin = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({
        correo: `no-existe-${Date.now()}@example.com`,
        password: 'cualquier-cosa-12345',
        captcha,
      });
    expect(failedLogin.status).toBe(401);

    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/audit-log?accion=login&limit=50')
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(response.status).toBe(200);
    const body = response.body as {
      items: {
        idUsuario: number | null;
        usuario: { nombre: string; correo: string } | null;
      }[];
    };
    const anonymousRow = body.items.find((item) => item.idUsuario === null);
    expect(anonymousRow).toBeDefined();
    expect(anonymousRow?.usuario).toBeNull();
  }, 30_000);
});
