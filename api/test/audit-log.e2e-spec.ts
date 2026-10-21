import { createHash } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { getRepositoryToken } from '@nestjs/typeorm';
import { authenticator } from 'otplib';
import request from 'supertest';
import { App } from 'supertest/types';
import sharp from 'sharp';
import { Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { AppConfigService } from './../src/config/app-config.service';
import { setupApp } from './../src/setup-app';
import { MailService } from './../src/mail/mail.service';
import { hashPassword } from './../src/common/utils/password-hash';
import {
  BitacoraAuditoria,
  CategoriaFraude,
  Plataforma,
  Usuario,
} from './../src/database/entities';
import {
  TestAdmin,
  createVerifiedAdmin,
  createVerifiedUser,
  generateTotpCode,
} from './utils/e2e-helpers';

interface CaptchaChallengeBody {
  algorithm: string;
  challenge: string;
  maxnumber: number;
  salt: string;
  signature: string;
}

interface SentMail {
  to: string;
  subject: string;
  text: string;
}

const CODIGO_PATTERN = /c[oó]digo es (\d+)/i;

/**
 * Cubre la sección 4.6 de MANUAL.md: cada flujo de auth/me debe escribir su
 * evento en Bitacora_auditoria, con id_usuario/ip/resultado correctos, y
 * nunca con contraseñas/tokens/captchas/códigos en `detalle`.
 */
describe('Bitácora de auditoría (e2e) — sección 4.6', () => {
  let app: NestExpressApplication;
  let appConfig: AppConfigService;
  let usuarioRepo: Repository<Usuario>;
  let bitacoraRepo: Repository<BitacoraAuditoria>;
  let plataformaRepo: Repository<Plataforma>;
  let categoriaRepo: Repository<CategoriaFraude>;
  let platformId: number;
  let categoryId: number;
  let mailSend: jest.Mock<Promise<void>, [SentMail]>;
  let originalThrottleAuthLimit: string | undefined;

  beforeAll(async () => {
    // Cada flujo de este archivo pasa por /auth/*, que normalmente limita a
    // 5 peticiones/min (4.4). Probar los 10 eventos de la sección 4.6 en un
    // solo archivo necesita muchas más — se sube el límite solo para esta
    // suite y se restaura después, sin tocar la configuración real.
    originalThrottleAuthLimit = process.env.THROTTLE_AUTH_LIMIT;
    process.env.THROTTLE_AUTH_LIMIT = '1000';

    mailSend = jest
      .fn<Promise<void>, [SentMail]>()
      .mockResolvedValue(undefined);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MailService)
      .useValue({ send: mailSend })
      .compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    appConfig = app.get(AppConfigService);
    setupApp(app, appConfig);
    await app.init();

    usuarioRepo = app.get<Repository<Usuario>>(getRepositoryToken(Usuario));
    bitacoraRepo = app.get<Repository<BitacoraAuditoria>>(
      getRepositoryToken(BitacoraAuditoria),
    );
    plataformaRepo = app.get<Repository<Plataforma>>(
      getRepositoryToken(Plataforma),
    );
    categoriaRepo = app.get<Repository<CategoriaFraude>>(
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

    authenticator.options = { step: 30, digits: 6, window: 1 };
  });

  afterAll(async () => {
    await app.close();
    if (originalThrottleAuthLimit === undefined) {
      delete process.env.THROTTLE_AUTH_LIMIT;
    } else {
      process.env.THROTTLE_AUTH_LIMIT = originalThrottleAuthLimit;
    }
  });

  function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  async function solveCaptcha(): Promise<string> {
    const response = await request(app.getHttpServer()).get(
      '/api/v1/auth/captcha',
    );
    const challenge = response.body as CaptchaChallengeBody;

    let foundNumber = -1;
    for (let number = 0; number <= challenge.maxnumber; number++) {
      if (sha256(challenge.salt + number.toString()) === challenge.challenge) {
        foundNumber = number;
        break;
      }
    }
    if (foundNumber === -1) {
      throw new Error('No se encontró un número solución.');
    }

    return Buffer.from(
      JSON.stringify({
        algorithm: challenge.algorithm,
        challenge: challenge.challenge,
        number: foundNumber,
        salt: challenge.salt,
        signature: challenge.signature,
      }),
    ).toString('base64');
  }

  /** Busca, desde el correo más reciente hacia atrás, el primero que cumpla el patrón (evita confundir el código de verificación con el de recuperación). */
  function extractLatestCode(pattern: RegExp): string {
    const calls = mailSend.mock.calls;
    for (let i = calls.length - 1; i >= 0; i--) {
      const match = pattern.exec(calls[i][0].text);
      if (match) {
        return match[1];
      }
    }
    throw new Error('No se encontró un código en los correos enviados.');
  }

  async function latestAuditRow(
    idUsuario: number,
    accion: string,
  ): Promise<BitacoraAuditoria | null> {
    return bitacoraRepo.findOne({
      where: { idUsuario, accion },
      order: { idEvento: 'DESC' },
    });
  }

  /** Nunca debe haber contraseñas, tokens, captchas ni códigos en `detalle` (4.6). */
  function expectDetalleSinSecretos(row: BitacoraAuditoria | null): void {
    expect(row).not.toBeNull();
    const detalleJson = JSON.stringify(row!.detalle);
    expect(detalleJson).not.toMatch(
      /contraseñ|password|token|captcha|c[oó]digo/i,
    );
  }

  // --- Usuario normal: registro → verificación → login → logout → logout-all → refresh ---

  const normalCorreo = `audit-e2e-${Date.now()}@example.com`;
  const passwordInicial = 'Xk9#mPq2vL7zT4Qw';
  let normalIdUsuario: number;

  it('registro escribe su evento con id_usuario, ip y resultado correctos', async () => {
    const captcha = await solveCaptcha();
    const response = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/register')
      .send({
        nombre: 'Audit E2E',
        correo: normalCorreo,
        password: passwordInicial,
        captcha,
      });
    expect(response.status).toBe(202);

    const usuario = await usuarioRepo.findOne({
      where: { correo: normalCorreo },
    });
    expect(usuario).not.toBeNull();
    normalIdUsuario = usuario!.idUsuario;

    const row = await latestAuditRow(normalIdUsuario, 'registro');
    expect(row).not.toBeNull();
    expect(row!.resultado).toBe('exito');
    expect(typeof row!.ip).toBe('string');
    expect(row!.ip).not.toBeNull();
    expectDetalleSinSecretos(row);
  });

  it('correo_verificado escribe su evento con ip (antes quedaba NULL)', async () => {
    const codigo = extractLatestCode(CODIGO_PATTERN);

    const response = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/verify-email')
      .send({ correo: normalCorreo, codigo });
    expect(response.status).toBe(200);

    const row = await latestAuditRow(normalIdUsuario, 'correo_verificado');
    expect(row).not.toBeNull();
    expect(row!.resultado).toBe('exito');
    expect(row!.ip).not.toBeNull();
    expectDetalleSinSecretos(row);
  });

  let accessToken1: string;

  it('login escribe su evento con ip y resultado "exito"', async () => {
    const captcha = await solveCaptcha();
    const response = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ correo: normalCorreo, password: passwordInicial, captcha });
    expect(response.status).toBe(200);

    const body = response.body as { accessToken: string };
    accessToken1 = body.accessToken;

    const row = await latestAuditRow(normalIdUsuario, 'login');
    expect(row).not.toBeNull();
    expect(row!.resultado).toBe('exito');
    expect(row!.ip).not.toBeNull();
    expectDetalleSinSecretos(row);
  });

  it('logout escribe su evento (antes no se registraba ninguno)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken1}`);
    expect(response.status).toBe(204);

    const row = await latestAuditRow(normalIdUsuario, 'logout');
    expect(row).not.toBeNull();
    expect(row!.resultado).toBe('exito');
    expect(row!.ip).not.toBeNull();
    expect(row!.recursoTipo).toBe('Sesion');
    expectDetalleSinSecretos(row);
  });

  it('logout-all escribe su propio evento "logout" (alcance: todas_las_sesiones)', async () => {
    const captcha = await solveCaptcha();
    const loginResponse = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ correo: normalCorreo, password: passwordInicial, captcha });
    const { accessToken } = loginResponse.body as { accessToken: string };

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(response.status).toBe(204);

    const row = await latestAuditRow(normalIdUsuario, 'logout');
    expect(row).not.toBeNull();
    expect(row!.resultado).toBe('exito');
    expect(row!.ip).not.toBeNull();
    expect(row!.detalle).toMatchObject({ alcance: 'todas_las_sesiones' });
    expectDetalleSinSecretos(row);
  });

  it('refresh_reuso_detectado escribe su evento al reutilizar un refresh token ya rotado', async () => {
    const captcha = await solveCaptcha();
    const loginResponse = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ correo: normalCorreo, password: passwordInicial, captcha });
    const { refreshToken } = loginResponse.body as { refreshToken: string };

    const firstRefresh = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });
    expect(firstRefresh.status).toBe(200);

    // El mismo token ya fue reemplazado: reusarlo dispara la detección (5.6).
    const reuseAttempt = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });
    expect(reuseAttempt.status).toBe(401);

    const row = await latestAuditRow(
      normalIdUsuario,
      'refresh_reuso_detectado',
    );
    expect(row).not.toBeNull();
    expect(row!.resultado).toBe('fallo');
    expect(row!.ip).not.toBeNull();
    expectDetalleSinSecretos(row);
  });

  // --- Recuperación de contraseña: password_recuperacion_solicitada → password_cambiada ---

  let nuevaPasswordTrasRecuperacion: string;

  it('password_recuperacion_solicitada escribe su evento al pedir el código', async () => {
    const captcha = await solveCaptcha();
    const response = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/forgot-password')
      .send({ correo: normalCorreo, captcha });
    expect(response.status).toBe(202);

    const row = await latestAuditRow(
      normalIdUsuario,
      'password_recuperacion_solicitada',
    );
    expect(row).not.toBeNull();
    expect(row!.resultado).toBe('exito');
    expect(row!.ip).not.toBeNull();
    expectDetalleSinSecretos(row);
  });

  it('password_cambiada escribe su evento al restablecer la contraseña', async () => {
    const codigo = extractLatestCode(CODIGO_PATTERN);
    nuevaPasswordTrasRecuperacion = 'Zm4$qLp9vK3xR8Tw';

    const captcha = await solveCaptcha();
    const response = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/reset-password')
      .send({
        correo: normalCorreo,
        codigo,
        nuevaPassword: nuevaPasswordTrasRecuperacion,
        captcha,
      });
    expect(response.status).toBe(200);

    const row = await latestAuditRow(normalIdUsuario, 'password_cambiada');
    expect(row).not.toBeNull();
    expect(row!.resultado).toBe('exito');
    expect(row!.ip).not.toBeNull();
    expectDetalleSinSecretos(row);
  });

  it('password_cambiada (vía PATCH /me/password) también escribe ip (antes faltaba el meta ahí)', async () => {
    const captcha = await solveCaptcha();
    const loginResponse = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({
        correo: normalCorreo,
        password: nuevaPasswordTrasRecuperacion,
        captcha,
      });
    const { accessToken } = loginResponse.body as { accessToken: string };

    const response = await request(app.getHttpServer() as App)
      .patch('/api/v1/me/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        passwordActual: nuevaPasswordTrasRecuperacion,
        nuevaPassword: 'Bq7!wNt2cV5yH1Ze',
      });
    expect(response.status).toBe(204);

    const row = await latestAuditRow(normalIdUsuario, 'password_cambiada');
    expect(row).not.toBeNull();
    expect(row!.resultado).toBe('exito');
    expect(row!.ip).not.toBeNull();
    expectDetalleSinSecretos(row);
  });

  // --- Bloqueo progresivo: cuenta_bloqueada ---

  it('cuenta_bloqueada escribe su evento tras 5 intentos fallidos', async () => {
    const correo = `audit-e2e-lockout-${Date.now()}@example.com`;
    const password = 'Nq8$rTp3xW6yM9Ks';
    const usuario = await usuarioRepo.save(
      usuarioRepo.create({
        nombre: 'Audit Lockout E2E',
        correo,
        passwordHash: await hashPassword(password),
        rol: 'usuario',
        correoVerificado: true,
        activo: true,
      }),
    );

    for (let i = 0; i < 5; i++) {
      const captcha = await solveCaptcha();
      const fail = await request(app.getHttpServer() as App)
        .post('/api/v1/auth/login')
        .send({ correo, password: 'contraseña-incorrecta', captcha });
      expect(fail.status).toBe(401);
    }

    // Contraseña correcta, pero ya bloqueada: debe seguir en 401, ahora por
    // cuenta_bloqueada en vez de credenciales inválidas.
    const captcha = await solveCaptcha();
    const blocked = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ correo, password, captcha });
    expect(blocked.status).toBe(401);

    const row = await latestAuditRow(usuario.idUsuario, 'cuenta_bloqueada');
    expect(row).not.toBeNull();
    expect(row!.resultado).toBe('fallo');
    expect(row!.ip).not.toBeNull();
    expectDetalleSinSecretos(row);
  });

  // --- Admin + 2FA: 2fa_fallo → 2fa_activado ---

  it('2fa_fallo y 2fa_activado escriben su evento al configurar 2FA', async () => {
    const correo = `audit-e2e-admin-${Date.now()}@example.com`;
    const password = 'Hs4@dCp7zQ2vL5Nx';
    const admin = await usuarioRepo.save(
      usuarioRepo.create({
        nombre: 'Audit Admin E2E',
        correo,
        passwordHash: await hashPassword(password),
        rol: 'admin',
        correoVerificado: true,
        activo: true,
      }),
    );

    const loginCaptcha = await solveCaptcha();
    const loginResponse = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ correo, password, captcha: loginCaptcha });
    expect(loginResponse.status).toBe(200);
    const { mfaToken } = loginResponse.body as { mfaToken: string };

    const setupResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/2fa/setup')
      .set('Authorization', `Bearer ${mfaToken}`);
    expect(setupResponse.status).toBe(200);
    const { otpauthUri } = setupResponse.body as { otpauthUri: string };
    const secretMatch = /secret=([^&]+)/.exec(otpauthUri);
    if (!secretMatch) {
      throw new Error('No se encontró el secreto en el otpauthUri.');
    }
    const secret = decodeURIComponent(secretMatch[1]);

    const failResponse = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/2fa/enable')
      .set('Authorization', `Bearer ${mfaToken}`)
      .send({ codigo: '000000' });
    expect(failResponse.status).toBe(401);

    const failRow = await latestAuditRow(admin.idUsuario, '2fa_fallo');
    expect(failRow).not.toBeNull();
    expect(failRow!.resultado).toBe('fallo');
    expect(failRow!.ip).not.toBeNull();
    expectDetalleSinSecretos(failRow);

    const codigoValido = authenticator.generate(secret);
    const enableResponse = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/2fa/enable')
      .set('Authorization', `Bearer ${mfaToken}`)
      .send({ codigo: codigoValido });
    expect(enableResponse.status).toBe(200);

    const enableRow = await latestAuditRow(admin.idUsuario, '2fa_activado');
    expect(enableRow).not.toBeNull();
    expect(enableRow!.resultado).toBe('exito');
    expect(enableRow!.ip).not.toBeNull();
    expectDetalleSinSecretos(enableRow);
  });

  // --- Acciones administrativas: admin_creado, reporte_revisado,
  // comentario_moderado, usuario_reactivado, evidencia_eliminada ---
  //
  // Estas 5 ya existían en el código (sección 4.6, MANUAL.md) pero ninguna
  // tenía una prueba que de verdad revisara su fila en Bitacora_auditoria
  // (solo el status code de la ruta) -- a diferencia de usuario_suspendido
  // (admin-user-status.e2e-spec.ts) y catalogo_modificado
  // (audit-concurrency.e2e-spec.ts), que sí la revisaban.

  async function freshAdminTotpCode(admin: TestAdmin): Promise<string> {
    await usuarioRepo.update(admin.idUsuario, { totpUltimoContador: null });
    return generateTotpCode(admin.totpSecret, 0);
  }

  async function createReport(accessToken: string): Promise<number> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/reports')
      .set('Authorization', `Bearer ${accessToken}`)
      .field('titulo', `Reporte bitácora e2e ${Date.now()}`)
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

  it('admin_creado escribe su evento al crear otro admin desde el panel', async () => {
    const admin = await createVerifiedAdmin(app, usuarioRepo);
    const correo = `audit-e2e-nuevo-admin-${Date.now()}@example.com`;

    const response = await request(app.getHttpServer() as App)
      .post('/api/v1/admin/admins')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        nombre: 'Nuevo Admin Audit E2E',
        correo,
        totp: await freshAdminTotpCode(admin),
      });
    expect(response.status).toBe(201);
    const nuevo = (response.body as { id: number }).id;

    const row = await latestAuditRow(admin.idUsuario, 'admin_creado');
    expect(row).not.toBeNull();
    expect(row!.resultado).toBe('exito');
    expect(row!.ip).not.toBeNull();
    expect(row!.recursoId).toBe(nuevo);
    expectDetalleSinSecretos(row);
  }, 30_000);

  it('reporte_revisado escribe su evento al validar un reporte', async () => {
    const admin = await createVerifiedAdmin(app, usuarioRepo);
    const author = await createVerifiedUser(app, usuarioRepo);
    const reportId = await createReport(author.accessToken);

    const response = await request(app.getHttpServer() as App)
      .post(`/api/v1/admin/reports/${reportId}/review`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ decision: 'validado' });
    expect(response.status).toBe(200);

    const row = await latestAuditRow(admin.idUsuario, 'reporte_revisado');
    expect(row).not.toBeNull();
    expect(row!.resultado).toBe('exito');
    expect(row!.ip).not.toBeNull();
    expect(row!.recursoId).toBe(reportId);
    expectDetalleSinSecretos(row);
  }, 30_000);

  it('comentario_moderado escribe su evento al confirmar un comentario oculto_auto', async () => {
    const admin = await createVerifiedAdmin(app, usuarioRepo);
    const author = await createVerifiedUser(app, usuarioRepo);
    const commenter = await createVerifiedUser(app, usuarioRepo);
    const flaggers = await Promise.all([
      createVerifiedUser(app, usuarioRepo),
      createVerifiedUser(app, usuarioRepo),
      createVerifiedUser(app, usuarioRepo),
    ]);
    const reportId = await createReport(author.accessToken);

    const commentResponse = await request(app.getHttpServer() as App)
      .post(`/api/v1/reports/${reportId}/comments`)
      .set('Authorization', `Bearer ${commenter.accessToken}`)
      .send({ contenido: 'Comentario de prueba de bitácora', anonimo: false });
    expect(commentResponse.status).toBe(201);
    const commentId = (commentResponse.body as { id: number }).id;

    for (const [i, flagger] of flaggers.entries()) {
      // NOSONAR: secuencial a propósito, para que `detalle: Denuncia ${i}`
      // quede en un orden predecible al revisarlo luego.
      const flagResponse = await request(app.getHttpServer() as App)
        .post(`/api/v1/comments/${commentId}/flags`)
        .set('Authorization', `Bearer ${flagger.accessToken}`)
        .send({ motivo: 'spam', detalle: `Denuncia ${i}` });
      expect(flagResponse.status).toBe(201);
    }

    const response = await request(app.getHttpServer() as App)
      .patch(`/api/v1/admin/comments/${commentId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ accion: 'confirmar' });
    expect(response.status).toBe(204);

    const row = await latestAuditRow(admin.idUsuario, 'comentario_moderado');
    expect(row).not.toBeNull();
    expect(row!.resultado).toBe('exito');
    expect(row!.ip).not.toBeNull();
    expect(row!.recursoId).toBe(commentId);
    expectDetalleSinSecretos(row);
  }, 30_000);

  it('usuario_reactivado escribe su evento al reactivar una cuenta suspendida', async () => {
    const admin = await createVerifiedAdmin(app, usuarioRepo);
    const target = await createVerifiedUser(app, usuarioRepo);

    const suspendResponse = await request(app.getHttpServer() as App)
      .patch(`/api/v1/admin/users/${target.idUsuario}/status`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ activo: false });
    expect(suspendResponse.status).toBe(204);

    const reactivateResponse = await request(app.getHttpServer() as App)
      .patch(`/api/v1/admin/users/${target.idUsuario}/status`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ activo: true });
    expect(reactivateResponse.status).toBe(204);

    const row = await latestAuditRow(admin.idUsuario, 'usuario_reactivado');
    expect(row).not.toBeNull();
    expect(row!.resultado).toBe('exito');
    expect(row!.ip).not.toBeNull();
    expect(row!.recursoId).toBe(target.idUsuario);
    expectDetalleSinSecretos(row);
  }, 30_000);

  it('evidencia_eliminada escribe su evento al quitar una imagen desde el panel', async () => {
    const admin = await createVerifiedAdmin(app, usuarioRepo);
    const author = await createVerifiedUser(app, usuarioRepo);
    const reportId = await createReport(author.accessToken);

    const image = await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 3,
        background: { r: 200, g: 50, b: 50 },
      },
    })
      .png()
      .toBuffer();

    const addResponse = await request(app.getHttpServer())
      .post(`/api/v1/reports/${reportId}/evidences`)
      .set('Authorization', `Bearer ${author.accessToken}`)
      .attach('evidencias', image, {
        filename: 'foto.png',
        contentType: 'image/png',
      });
    expect(addResponse.status).toBe(201);
    const evidenceId = (addResponse.body as { evidencias: { id: number }[] })
      .evidencias[0].id;

    const response = await request(app.getHttpServer())
      .delete(`/api/v1/admin/reports/${reportId}/evidences/${evidenceId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`);
    expect(response.status).toBe(204);

    const row = await latestAuditRow(admin.idUsuario, 'evidencia_eliminada');
    expect(row).not.toBeNull();
    expect(row!.resultado).toBe('exito');
    expect(row!.ip).not.toBeNull();
    expect(row!.recursoId).toBe(evidenceId);
    expectDetalleSinSecretos(row);
  }, 30_000);
});
