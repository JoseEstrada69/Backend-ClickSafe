import { createHash } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { AppConfigService } from './../src/config/app-config.service';
import { setupApp } from './../src/setup-app';
import { TokenVerificacion, Usuario } from './../src/database/entities';

interface CaptchaChallengeBody {
  algorithm: string;
  challenge: string;
  maxnumber: number;
  salt: string;
  signature: string;
}

const MARGIN_MS = 5000;
const EXPECTED_TTL_MS = 30 * 60_000; // verificacion_correo (5.3): 30 minutos.
const TTL_MARGIN_MS = 2000;

describe('Zona horaria de MySQL (e2e) — corrección reportada en Workbench', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let tokenRepo: Repository<TokenVerificacion>;
  let usuarioRepo: Repository<Usuario>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    setupApp(app, app.get(AppConfigService));
    await app.init();

    dataSource = app.get(DataSource);
    tokenRepo = app.get<Repository<TokenVerificacion>>(
      getRepositoryToken(TokenVerificacion),
    );
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

  it('SELECT NOW() desde la conexión de la API coincide con la hora UTC de Node (margen de pocos segundos)', async () => {
    const rows = await dataSource.query<{ mysqlNow: Date }[]>(
      'SELECT NOW() AS mysqlNow',
    );
    const mysqlNow = rows[0].mysqlNow;
    const nodeNow = new Date();

    // Si SET time_zone='+00:00' no se aplicó en esta conexión del pool,
    // mysqlNow quedaría ~6 horas atrás (hora local de México) y esta
    // diferencia sería enorme, no de unos segundos.
    const diffMs = Math.abs(mysqlNow.getTime() - nodeNow.getTime());
    expect(diffMs).toBeLessThan(MARGIN_MS);
  });

  it('un código de verificación recién creado tiene expira_en - fecha_creacion = 30 minutos (margen de red/proceso)', async () => {
    const captcha = await solveCaptcha();
    const correo = `tz-e2e-${Date.now()}@example.com`;

    const registerResponse = await request(app.getHttpServer() as App)
      .post('/api/v1/auth/register')
      .send({
        nombre: 'TZ E2E',
        correo,
        password: 'Xk9#mPq2vL7zT4Qw',
        captcha,
      });
    expect(registerResponse.status).toBe(202);

    const usuario = await usuarioRepo.findOne({ where: { correo } });
    expect(usuario).not.toBeNull();

    const token = await tokenRepo.findOne({
      where: { idUsuario: usuario!.idUsuario, tipo: 'verificacion_correo' },
      order: { idToken: 'DESC' },
    });
    expect(token).not.toBeNull();

    const ttlMs = token!.expiraEn.getTime() - token!.fechaCreacion.getTime();
    expect(Math.abs(ttlMs - EXPECTED_TTL_MS)).toBeLessThan(TTL_MARGIN_MS);

    // fecha_creacion la llena MySQL con CURRENT_TIMESTAMP: si la sesión no
    // estuviera en UTC, quedaría ~6 horas desfasada de "ahora", no de unos
    // segundos (el bug reportado: 02:39 local vs. 09:09 UTC).
    const creationDiffMs = Math.abs(
      token!.fechaCreacion.getTime() - Date.now(),
    );
    expect(creationDiffMs).toBeLessThan(MARGIN_MS);
  });
});
