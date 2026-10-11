import { createHash } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { AppConfigService } from './../src/config/app-config.service';
import { setupApp } from './../src/setup-app';
import { Usuario } from './../src/database/entities';

interface CaptchaChallengeBody {
  algorithm: string;
  challenge: string;
  maxnumber: number;
  salt: string;
  signature: string;
}

/**
 * Los dos tipos de token de la sección 5.5 (mfaToken y accessToken) nunca
 * deben poder usarse uno en lugar del otro: MfaOrAdminSessionGuard y
 * JwtAuthGuard verifican cada uno con su propio secreto
 * (JWT_MFA_SECRET / JWT_ACCESS_SECRET), así que un token firmado con el
 * secreto equivocado nunca pasa, sin importar su contenido.
 */
describe('MFA token vs. access token (e2e) — no deben ser intercambiables', () => {
  let app: NestExpressApplication;
  let jwtService: JwtService;
  let appConfig: AppConfigService;
  let usuarioRepo: Repository<Usuario>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    appConfig = app.get(AppConfigService);
    setupApp(app, appConfig);
    await app.init();

    jwtService = app.get(JwtService);
    usuarioRepo = app.get<Repository<Usuario>>(getRepositoryToken(Usuario));
  });

  afterAll(async () => {
    await app.close();
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
      throw new Error(
        'No se encontró un número solución (prueba mal construida).',
      );
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

  /** Registra, verifica (sin pasar por el correo) y loguea un usuario normal; devuelve su accessToken real. */
  async function createVerifiedUserAccessToken(): Promise<string> {
    const correo = `mfa-guard-e2e-${Date.now()}@example.com`;
    const password = 'Xk9#mPq2vL7zT4Qw';

    const registerCaptcha = await solveCaptcha();
    const registerResponse = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/register')
      .send({
        nombre: 'MFA Guard E2E',
        correo,
        password,
        captcha: registerCaptcha,
      });
    expect(registerResponse.status).toBe(202);

    // Atajo de prueba: evita depender de Mailpit para leer el código de
    // verificación. No usamos el repo para nada relacionado al guard que
    // estamos probando, solo para dejar la cuenta en un estado realista
    // (correo_verificado = true) antes de loguear de verdad.
    await usuarioRepo.update({ correo }, { correoVerificado: true });

    const loginCaptcha = await solveCaptcha();
    const loginResponse = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({ correo, password, captcha: loginCaptcha });
    expect(loginResponse.status).toBe(200);

    const body = loginResponse.body as { accessToken: string };
    expect(typeof body.accessToken).toBe('string');
    return body.accessToken;
  }

  /** Firma un mfaToken real (mismo secreto/claims que MfaService.issueMfaToken), con el TTL que se quiera. */
  function signMfaToken(expiresInSeconds: number): string {
    const { jwt } = appConfig;
    return jwtService.sign(
      { sub: 999_999, typ: 'mfa' },
      {
        secret: jwt.mfaSecret,
        algorithm: 'HS256',
        issuer: jwt.issuer,
        audience: jwt.audience,
        expiresIn: expiresInSeconds,
      },
    );
  }

  it('un mfaToken usado en GET /me responde 401 (JwtAuthGuard solo acepta el access token)', async () => {
    const mfaToken = signMfaToken(5 * 60);

    const response = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${mfaToken}`);

    expect(response.status).toBe(401);
  });

  it('el accessToken de un usuario normal usado en /auth/2fa/setup responde 401 o 403', async () => {
    const accessToken = await createVerifiedUserAccessToken();

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/2fa/setup')
      .set('Authorization', `Bearer ${accessToken}`);

    expect([401, 403]).toContain(response.status);
  });

  it('un mfaToken expirado (ventana de 5 minutos ya pasada) responde 401', async () => {
    const expiredMfaToken = signMfaToken(-1);

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/2fa/setup')
      .set('Authorization', `Bearer ${expiredMfaToken}`);

    expect(response.status).toBe(401);
  });
});
