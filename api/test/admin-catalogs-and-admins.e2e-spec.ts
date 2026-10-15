import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { AppConfigService } from './../src/config/app-config.service';
import { setupApp } from './../src/setup-app';
import { MailService } from './../src/mail/mail.service';
import {
  Plataforma,
  TokenVerificacion,
  Usuario,
} from './../src/database/entities';
import {
  TestAdmin,
  createVerifiedAdmin,
  createVerifiedUser,
  generateTotpCode,
  raiseAuthThrottleForTests,
  usuarioRepoFrom,
} from './utils/e2e-helpers';

/**
 * POST /admin/admins (reautenticación con TOTP + contraseña inutilizable +
 * código de recuperación, sección 7/8) y /admin/platforms /admin/categories
 * (alta/edición sin DELETE, es_otra fuera del control de la API, "Otra"
 * nunca se puede desactivar — sección 1 regla 10 y aclaración del usuario).
 */
describe('Admin (e2e) — admins y catálogos', () => {
  let app: NestExpressApplication;
  let usuarioRepo: Repository<Usuario>;
  let plataformaRepo: Repository<Plataforma>;
  let tokenRepo: Repository<TokenVerificacion>;
  let admin: TestAdmin;
  let restoreThrottle: () => void;

  beforeAll(async () => {
    restoreThrottle = raiseAuthThrottleForTests();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MailService)
      .useValue({ send: jest.fn().mockResolvedValue(undefined) })
      .compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    setupApp(app, app.get(AppConfigService));
    await app.init();

    usuarioRepo = usuarioRepoFrom(app);
    plataformaRepo = app.get<Repository<Plataforma>>(
      getRepositoryToken(Plataforma),
    );
    tokenRepo = app.get<Repository<TokenVerificacion>>(
      getRepositoryToken(TokenVerificacion),
    );

    admin = await createVerifiedAdmin(app, usuarioRepo);
  }, 30_000);

  afterAll(async () => {
    await app.close();
    restoreThrottle();
  });

  /**
   * generateTotpCode(secret, 0) solo es válido si su contador queda
   * estrictamente por encima de totp_ultimo_contador (anti-reuso, 5.5). En
   * vez de adivinar un offset relativo al último uso de admin.totpSecret
   * (frágil: depende de cuánto tiempo real pasó desde createVerifiedAdmin),
   * se resetea el contador a NULL justo antes de generar el código: así
   * offset 0 (el real "ahora") siempre es válido y sigue siendo UN código
   * nuevo, nunca reutilizado.
   */
  async function freshAdminTotpCode(): Promise<string> {
    await usuarioRepo.update(admin.idUsuario, { totpUltimoContador: null });
    return generateTotpCode(admin.totpSecret, 0);
  }

  describe('POST /admin/admins', () => {
    it('crea un admin con el TOTP del admin que llama (reautenticación)', async () => {
      const correo = `nuevo-admin-${Date.now()}@example.com`;
      const response = await request(app.getHttpServer() as App)
        .post('/api/v1/admin/admins')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          nombre: 'Nuevo Admin',
          correo,
          totp: await freshAdminTotpCode(),
        });

      expect(response.status).toBe(201);
      const body = response.body as {
        id: number;
        correo: string;
        rol: string;
        activo: boolean;
        correoVerificado: boolean;
      };
      expect(body.correo).toBe(correo);
      expect(body.rol).toBe('admin');
      expect(body.activo).toBe(true);
      expect(body.correoVerificado).toBe(true);

      // Nace con contraseña inutilizable + código de recuperación (5.7):
      // nadie, ni quien lo creó, conoce una contraseña inicial.
      const nuevo = await usuarioRepo.findOne({ where: { correo } });
      expect(nuevo).not.toBeNull();
      const token = await tokenRepo.findOne({
        where: {
          idUsuario: nuevo!.idUsuario,
          tipo: 'recuperacion_password',
        },
      });
      expect(token).not.toBeNull();
    });

    it('un código TOTP incorrecto responde 400 INVALID_TOTP y no crea la cuenta', async () => {
      const correo = `admin-rechazado-${Date.now()}@example.com`;
      const response = await request(app.getHttpServer() as App)
        .post('/api/v1/admin/admins')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ nombre: 'Rechazado', correo, totp: '000000' });

      expect(response.status).toBe(400);
      expect((response.body as { code?: string }).code).toBe('INVALID_TOTP');
      const existing = await usuarioRepo.findOne({ where: { correo } });
      expect(existing).toBeNull();
    });

    it('un correo ya registrado responde 409 EMAIL_TAKEN', async () => {
      const correo = `admin-duplicado-${Date.now()}@example.com`;
      const first = await request(app.getHttpServer() as App)
        .post('/api/v1/admin/admins')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ nombre: 'Primero', correo, totp: await freshAdminTotpCode() });
      expect(first.status).toBe(201);

      const second = await request(app.getHttpServer() as App)
        .post('/api/v1/admin/admins')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          nombre: 'Segundo',
          correo,
          totp: await freshAdminTotpCode(),
        });
      expect(second.status).toBe(409);
      expect((second.body as { code?: string }).code).toBe('EMAIL_TAKEN');
    });

    it('un usuario normal no puede crear admins (403)', async () => {
      const normalUser = await createVerifiedUser(app, usuarioRepo);
      const response = await request(app.getHttpServer() as App)
        .post('/api/v1/admin/admins')
        .set('Authorization', `Bearer ${normalUser.accessToken}`)
        .send({
          nombre: 'Intento',
          correo: `intento-${Date.now()}@example.com`,
          totp: '000000',
        });
      expect(response.status).toBe(403);
    });

    it('mandar "rol" en el body responde 400 (mass assignment)', async () => {
      const response = await request(app.getHttpServer() as App)
        .post('/api/v1/admin/admins')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          nombre: 'Con rol extra',
          correo: `con-rol-${Date.now()}@example.com`,
          totp: await freshAdminTotpCode(),
          rol: 'usuario',
        });
      expect(response.status).toBe(400);
    });
  });

  describe('/admin/platforms', () => {
    it('crea una plataforma nueva (activa por defecto, esOtra siempre false)', async () => {
      const nombre = `Plataforma E2E ${Date.now()}`;
      const response = await request(app.getHttpServer() as App)
        .post('/api/v1/admin/platforms')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ nombre });

      expect(response.status).toBe(201);
      const body = response.body as {
        id: number;
        nombre: string;
        esOtra: boolean;
        activa: boolean;
      };
      expect(body.nombre).toBe(nombre);
      expect(body.esOtra).toBe(false);
      expect(body.activa).toBe(true);
    });

    it('mandar "esOtra" en el body responde 400 (no se puede crear ni modificar vía API)', async () => {
      const response = await request(app.getHttpServer() as App)
        .post('/api/v1/admin/platforms')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ nombre: `Con esOtra ${Date.now()}`, esOtra: true });
      expect(response.status).toBe(400);
    });

    it('crear dos plataformas con el mismo nombre responde 409 CATALOG_NAME_TAKEN', async () => {
      const nombre = `Duplicada E2E ${Date.now()}`;
      const first = await request(app.getHttpServer() as App)
        .post('/api/v1/admin/platforms')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ nombre });
      expect(first.status).toBe(201);

      const second = await request(app.getHttpServer() as App)
        .post('/api/v1/admin/platforms')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ nombre });
      expect(second.status).toBe(409);
      expect((second.body as { code?: string }).code).toBe(
        'CATALOG_NAME_TAKEN',
      );
    });

    it('renombrar una plataforma al nombre de otra responde 409 CATALOG_NAME_TAKEN', async () => {
      const nombreExistente = `Plataforma Existente E2E ${Date.now()}`;
      await request(app.getHttpServer() as App)
        .post('/api/v1/admin/platforms')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ nombre: nombreExistente });

      const createResponse = await request(app.getHttpServer() as App)
        .post('/api/v1/admin/platforms')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ nombre: `Plataforma A Renombrar E2E ${Date.now()}` });
      const { id } = createResponse.body as { id: number };

      const renameResponse = await request(app.getHttpServer() as App)
        .patch(`/api/v1/admin/platforms/${id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ nombre: nombreExistente });
      expect(renameResponse.status).toBe(409);
      expect((renameResponse.body as { code?: string }).code).toBe(
        'CATALOG_NAME_TAKEN',
      );
    });

    it('nunca se puede desactivar la plataforma "Otra"', async () => {
      const otra = await plataformaRepo.findOne({ where: { esOtra: true } });
      expect(otra).not.toBeNull();

      const response = await request(app.getHttpServer() as App)
        .patch(`/api/v1/admin/platforms/${otra!.idPlataforma}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ activa: false });

      expect(response.status).toBe(400);
      const stillActive = await plataformaRepo.findOne({
        where: { idPlataforma: otra!.idPlataforma },
      });
      expect(stillActive!.activa).toBe(true);
    });

    it('PATCH con "esOtra" responde 400, y se puede desactivar una plataforma normal', async () => {
      const createResponse = await request(app.getHttpServer() as App)
        .post('/api/v1/admin/platforms')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ nombre: `Desactivable E2E ${Date.now()}` });
      const { id } = createResponse.body as { id: number };

      const rejected = await request(app.getHttpServer() as App)
        .patch(`/api/v1/admin/platforms/${id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ esOtra: true });
      expect(rejected.status).toBe(400);

      const accepted = await request(app.getHttpServer() as App)
        .patch(`/api/v1/admin/platforms/${id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ activa: false });
      expect(accepted.status).toBe(200);
      expect((accepted.body as { activa: boolean }).activa).toBe(false);
    });

    it('GET /admin/platforms incluye inactivas; GET /platforms público no', async () => {
      const createResponse = await request(app.getHttpServer() as App)
        .post('/api/v1/admin/platforms')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ nombre: `Oculta E2E ${Date.now()}` });
      const { id } = createResponse.body as { id: number };
      await request(app.getHttpServer() as App)
        .patch(`/api/v1/admin/platforms/${id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ activa: false });

      const adminList = await request(app.getHttpServer())
        .get('/api/v1/admin/platforms')
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(
        (adminList.body as { id: number }[]).some((p) => p.id === id),
      ).toBe(true);

      const normalUser = await createVerifiedUser(app, usuarioRepo);
      const publicList = await request(app.getHttpServer())
        .get('/api/v1/platforms')
        .set('Authorization', `Bearer ${normalUser.accessToken}`);
      expect(
        (publicList.body as { id: number }[]).some((p) => p.id === id),
      ).toBe(false);
    });
  });

  describe('/admin/categories', () => {
    it('crea una categoría nueva', async () => {
      const nombre = `Categoría E2E ${Date.now()}`;
      const response = await request(app.getHttpServer() as App)
        .post('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ nombre, descripcion: 'Descripción de prueba.' });

      expect(response.status).toBe(201);
      const body = response.body as { nombre: string; activa: boolean };
      expect(body.nombre).toBe(nombre);
      expect(body.activa).toBe(true);
    });

    it('crear dos categorías con el mismo nombre responde 409 CATALOG_NAME_TAKEN', async () => {
      const nombre = `Categoría Duplicada E2E ${Date.now()}`;
      const first = await request(app.getHttpServer() as App)
        .post('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ nombre });
      expect(first.status).toBe(201);

      const second = await request(app.getHttpServer() as App)
        .post('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ nombre });
      expect(second.status).toBe(409);
      expect((second.body as { code?: string }).code).toBe(
        'CATALOG_NAME_TAKEN',
      );
    });

    it('renombrar una categoría al nombre de otra responde 409 CATALOG_NAME_TAKEN', async () => {
      const nombreExistente = `Categoría Existente E2E ${Date.now()}`;
      await request(app.getHttpServer() as App)
        .post('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ nombre: nombreExistente });

      const createResponse = await request(app.getHttpServer() as App)
        .post('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ nombre: `Categoría A Renombrar E2E ${Date.now()}` });
      const { id } = createResponse.body as { id: number };

      const renameResponse = await request(app.getHttpServer() as App)
        .patch(`/api/v1/admin/categories/${id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ nombre: nombreExistente });
      expect(renameResponse.status).toBe(409);
      expect((renameResponse.body as { code?: string }).code).toBe(
        'CATALOG_NAME_TAKEN',
      );
    });

    it('PATCH puede desactivar y reactivar una categoría', async () => {
      const createResponse = await request(app.getHttpServer() as App)
        .post('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ nombre: `Categoría Toggle E2E ${Date.now()}` });
      const { id } = createResponse.body as { id: number };

      const deactivated = await request(app.getHttpServer() as App)
        .patch(`/api/v1/admin/categories/${id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ activa: false });
      expect(deactivated.status).toBe(200);
      expect((deactivated.body as { activa: boolean }).activa).toBe(false);

      const reactivated = await request(app.getHttpServer() as App)
        .patch(`/api/v1/admin/categories/${id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ activa: true });
      expect(reactivated.status).toBe(200);
      expect((reactivated.body as { activa: boolean }).activa).toBe(true);
    });
  });
});
