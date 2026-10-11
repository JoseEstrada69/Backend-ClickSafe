import { createHash } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { Usuario } from './../../src/database/entities';

interface CaptchaChallengeBody {
  algorithm: string;
  challenge: string;
  maxnumber: number;
  salt: string;
  signature: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * /auth/* limita a 5 peticiones/min (4.4). Varios escenarios de un mismo
 * archivo e2e (cada uno registra y loguea uno o más usuarios) agotan ese
 * límite enseguida — se sube solo para la suite y se restaura en afterAll,
 * sin tocar la configuración real.
 */
export function raiseAuthThrottleForTests(): () => void {
  const original = process.env.THROTTLE_AUTH_LIMIT;
  process.env.THROTTLE_AUTH_LIMIT = '1000';
  return () => {
    if (original === undefined) {
      delete process.env.THROTTLE_AUTH_LIMIT;
    } else {
      process.env.THROTTLE_AUTH_LIMIT = original;
    }
  };
}

/** Resuelve un reto real contra GET /auth/captcha, igual que un cliente legítimo. */
export async function solveCaptcha(
  app: NestExpressApplication,
): Promise<string> {
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

export interface TestUser {
  idUsuario: number;
  correo: string;
  accessToken: string;
}

/**
 * Registra, verifica (vía repo, sin depender de Mailpit) y loguea un
 * usuario normal real a través de los endpoints HTTP — atajo de prueba
 * solo para el paso de verificación de correo, todo lo demás es el flujo
 * real.
 */
export async function createVerifiedUser(
  app: NestExpressApplication,
  usuarioRepo: Repository<Usuario>,
  options: { nombre?: string; password?: string } = {},
): Promise<TestUser> {
  const correo = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = options.password ?? 'Xk9#mPq2vL7zT4Qw';
  const nombre = options.nombre ?? 'Usuario E2E';

  const registerCaptcha = await solveCaptcha(app);
  const registerResponse = await request(app.getHttpServer() as App)
    .post('/api/v1/auth/register')
    .send({ nombre, correo, password, captcha: registerCaptcha });
  if (registerResponse.status !== 202) {
    throw new Error(
      `register falló: ${registerResponse.status} ${JSON.stringify(registerResponse.body)}`,
    );
  }

  await usuarioRepo.update({ correo }, { correoVerificado: true });

  const loginCaptcha = await solveCaptcha(app);
  const loginResponse = await request(app.getHttpServer() as App)
    .post('/api/v1/auth/login')
    .send({ correo, password, captcha: loginCaptcha });
  if (loginResponse.status !== 200) {
    throw new Error(
      `login falló: ${loginResponse.status} ${JSON.stringify(loginResponse.body)}`,
    );
  }

  const usuario = await usuarioRepo.findOne({ where: { correo } });
  if (!usuario) {
    throw new Error('No se encontró el usuario recién creado.');
  }

  const body = loginResponse.body as { accessToken: string };
  return {
    idUsuario: usuario.idUsuario,
    correo,
    accessToken: body.accessToken,
  };
}

export function usuarioRepoFrom(
  app: NestExpressApplication,
): Repository<Usuario> {
  return app.get<Repository<Usuario>>(getRepositoryToken(Usuario));
}
