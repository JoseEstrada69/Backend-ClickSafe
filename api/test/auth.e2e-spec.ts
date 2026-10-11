import { createHash } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AppConfigService } from './../src/config/app-config.service';
import { setupApp } from './../src/setup-app';

interface CaptchaChallengeBody {
  algorithm: string;
  challenge: string;
  maxnumber: number;
  salt: string;
  signature: string;
}

describe('Auth (e2e) — correcciones reportadas al probar en Swagger', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    setupApp(app, app.get(AppConfigService));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  /** Resuelve un reto real contra GET /auth/captcha (igual que un cliente legítimo, sección 5.2). */
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

  it('un User-Agent de 5000 caracteres en /auth/login no responde 500 (se recorta a 255 antes de guardarse)', async () => {
    const captcha = await solveCaptcha();
    const hugeUserAgent = 'A'.repeat(5000);

    const response = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .set('User-Agent', hugeUserAgent)
      .send({
        correo: 'no-existe-e2e@example.com',
        password: 'cualquier-password-123',
        captcha,
      });

    // Usuario inexistente + captcha válido: debe llegar hasta el intento de
    // auditar el login fallido (que es justo donde se escribe user_agent en
    // Bitacora_auditoria) y responder 401, nunca 500.
    expect(response.status).toBe(401);
    expect(response.status).not.toBe(500);
  });

  it('GET /auth/captcha no exige ningún header (User-Agent ausente) y no aparece como parámetro requerido', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/captcha')
      .unset('User-Agent');

    expect(response.status).toBe(200);
  });

  it('POST /auth/register responde 202 (no crea un recurso con URI propia)', async () => {
    const captcha = await solveCaptcha();

    const response = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/register')
      .send({
        nombre: 'E2E Test',
        correo: `e2e-register-${Date.now()}@example.com`,
        password: 'Xk9#mPq2vL7zT4Qw',
        captcha,
      });

    expect(response.status).toBe(202);
  });

  it('POST /auth/login con credenciales inexistentes responde 401 (no 201/200 por default de Nest)', async () => {
    const captcha = await solveCaptcha();

    const response = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/login')
      .send({
        correo: 'otro-no-existe-e2e@example.com',
        password: 'cualquier-password-123',
        captcha,
      });

    expect(response.status).toBe(401);
  });
});
