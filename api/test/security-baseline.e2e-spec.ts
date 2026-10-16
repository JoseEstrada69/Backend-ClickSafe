import { createHash } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AppConfigService } from './../src/config/app-config.service';
import { setupApp } from './../src/setup-app';
import { createVerifiedUser, usuarioRepoFrom } from './utils/e2e-helpers';

interface CaptchaChallengeBody {
  algorithm: string;
  challenge: string;
  maxnumber: number;
  salt: string;
  signature: string;
}

/**
 * Casos base de seguridad que pide el reporte del curso (Fase 7) y que
 * ningún otro archivo e2e cubre todavía: mass assignment en el registro,
 * un access token manipulado, y el límite de peticiones real (429).
 *
 * Cada prueba crea y cierra su PROPIA instancia de la app (no una
 * compartida en beforeAll): el contador del throttler es en memoria, por
 * instancia de la app, así que si dos pruebas de este mismo archivo
 * compartieran la app, las peticiones de /auth/* de la primera (captcha,
 * registro, login) se sumarían al presupuesto de la siguiente y la
 * prueba de rate limit (que necesita el límite real de 5/min, sin
 * raiseAuthThrottleForTests) podría recibir un 429 antes de tiempo o,
 * al revés, nunca alcanzarlo si otra prueba ya lo hubiera agotado.
 */
describe('Seguridad base (e2e)', () => {
  async function createApp(): Promise<NestExpressApplication> {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleFixture.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    setupApp(app, app.get(AppConfigService));
    await app.init();
    return app;
  }

  function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  async function solveCaptcha(app: NestExpressApplication): Promise<string> {
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

  it('mandar "rol" en POST /auth/register responde 400 (mass assignment)', async () => {
    const app = await createApp();
    try {
      const captcha = await solveCaptcha(app);

      const response = await request(app.getHttpServer() as App)
        .post('/api/v1/auth/register')
        .send({
          nombre: 'Intento Mass Assignment',
          correo: `mass-assignment-${Date.now()}@example.com`,
          password: 'Xk9#mPq2vL7zT4Qw',
          captcha,
          rol: 'admin',
        });

      expect(response.status).toBe(400);
    } finally {
      await app.close();
    }
  }, 30_000);

  it('un access token manipulado (firma rota) responde 401', async () => {
    const app = await createApp();
    try {
      const usuarioRepo = usuarioRepoFrom(app);
      const user = await createVerifiedUser(app, usuarioRepo);

      // Cambia el último carácter de la firma: el payload decodifica igual,
      // pero la firma HS256 ya no corresponde -- JwtAuthGuard debe
      // rechazarlo sin importar que el payload "se vea" válido.
      const partes = user.accessToken.split('.');
      const ultimoCaracter = partes[2].at(-1);
      const firmaRota =
        partes[2].slice(0, -1) + (ultimoCaracter === 'A' ? 'B' : 'A');
      const tokenManipulado = `${partes[0]}.${partes[1]}.${firmaRota}`;

      const response = await request(app.getHttpServer())
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${tokenManipulado}`);

      expect(response.status).toBe(401);
    } finally {
      await app.close();
    }
  }, 30_000);

  it('excede el límite de /auth/* (5 por minuto) y responde 429', async () => {
    const app = await createApp();
    try {
      const responses = [];
      for (let i = 0; i < 6; i++) {
        responses.push(
          await request(app.getHttpServer()).get('/api/v1/auth/captcha'),
        );
      }

      const statuses = responses.map((r) => r.status);
      expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
      expect(statuses[5]).toBe(429);
    } finally {
      await app.close();
    }
  }, 30_000);
});
