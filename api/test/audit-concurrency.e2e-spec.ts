import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AppConfigService } from './../src/config/app-config.service';
import { setupApp } from './../src/setup-app';
import {
  TestAdmin,
  createVerifiedAdmin,
  raiseAuthThrottleForTests,
  usuarioRepoFrom,
} from './utils/e2e-helpers';

interface AuditLogEntry {
  id: string;
  recursoTipo: string | null;
  recursoId: number | null;
  ip: string | null;
  userAgent: string | null;
}

/**
 * Un escaneo activo (OWASP ZAP) con sesión de admin dejó cientos de filas en
 * Plataforma/Categoria_fraude pero solo 3 eventos catalogo_modificado en
 * Bitacora_auditoria, los 3 con ip/user_agent en null. La causa confirmada de
 * lo segundo: createPlatform/updatePlatform/createCategory/updateCategory
 * nunca recibían @ClientInfo() (a diferencia de createAdmin, que sí). Ya se
 * corrigió. La pérdida bajo carga no se pudo reproducir con el código actual
 * (ver docs/seguridad.md), pero se endureció de todas formas: pool de
 * conexiones explícito (DB_POOL_SIZE) y un reintento en AuditService.log.
 * Esta prueba cubre ambas cosas a la vez: concurrencia real + ip/userAgent.
 */
describe('Bitácora bajo carga concurrente (e2e)', () => {
  let app: NestExpressApplication;
  let admin: TestAdmin;
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

    admin = await createVerifiedAdmin(app, usuarioRepoFrom(app));
  }, 30_000);

  afterAll(async () => {
    await app.close();
    restoreThrottle();
  });

  it('50 creaciones concurrentes de plataforma quedan TODAS en la bitácora, con ip y userAgent', async () => {
    const prefix = `Concurrencia E2E ${Date.now()} `;
    const N = 50;

    const responses = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        request(app.getHttpServer() as App)
          .post('/api/v1/admin/platforms')
          .set('Authorization', `Bearer ${admin.accessToken}`)
          .set('User-Agent', 'audit-concurrency-e2e')
          .send({ nombre: `${prefix}${i}` }),
      ),
    );

    const createdIds = responses.map((r) => {
      expect(r.status).toBe(201);
      return (r.body as { id: number }).id;
    });
    expect(createdIds).toHaveLength(N);

    const auditResponse = await request(app.getHttpServer())
      .get('/api/v1/admin/audit-log')
      .query({ accion: 'catalogo_modificado', limit: 50, page: 1 })
      .set('Authorization', `Bearer ${admin.accessToken}`);
    expect(auditResponse.status).toBe(200);

    const items = (
      auditResponse.body as { items: AuditLogEntry[]; total: number }
    ).items.filter(
      (e) =>
        e.recursoTipo === 'Plataforma' && createdIds.includes(e.recursoId!),
    );

    expect(items).toHaveLength(N);
    for (const entry of items) {
      expect(entry.ip).not.toBeNull();
      expect(entry.userAgent).not.toBeNull();
    }
  }, 30_000);
});
