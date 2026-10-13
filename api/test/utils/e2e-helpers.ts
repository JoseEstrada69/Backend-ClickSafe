import { createHash } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import { getRepositoryToken } from '@nestjs/typeorm';
import { authenticator } from 'otplib';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { hashPassword } from './../../src/common/utils/password-hash';
import { Usuario } from './../../src/database/entities';

const TOTP_STEP_SECONDS = 30;
authenticator.options = { step: TOTP_STEP_SECONDS, digits: 6, window: 1 };

/**
 * Genera un código TOTP para la ventana actual + `windowOffset` pasos de
 * 30s, sin dormir el proceso: evita que enable2fa y verify2fa generen el
 * MISMO código (mismo contador), que el servidor rechazaría como reuso
 * (5.5, totp_ultimo_contador).
 */
export function generateTotpCode(secret: string, windowOffset = 0): string {
  const previous = authenticator.options;
  authenticator.options = {
    ...previous,
    epoch: Date.now() + windowOffset * TOTP_STEP_SECONDS * 1000,
  };
  try {
    return authenticator.generate(secret);
  } finally {
    authenticator.options = previous;
  }
}

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

export interface TestAdmin extends TestUser {
  totpSecret: string;
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

/**
 * Crea un admin real con 2FA activo y una sesión completa (mfa: true) de
 * punta a punta: inserta el usuario directamente (section 8 — nadie se
 * vuelve admin por una ruta pública), pero todo el 2FA corre por los
 * endpoints reales (/2fa/setup, /2fa/enable, /2fa/verify), igual que un
 * admin de verdad.
 */
export async function createVerifiedAdmin(
  app: NestExpressApplication,
  usuarioRepo: Repository<Usuario>,
  options: { nombre?: string; password?: string } = {},
): Promise<TestAdmin> {
  const correo = `e2e-admin-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = options.password ?? 'Xk9#mPq2vL7zT4Qw';
  const nombre = options.nombre ?? 'Admin E2E';

  const usuario = await usuarioRepo.save(
    usuarioRepo.create({
      nombre,
      correo,
      passwordHash: await hashPassword(password),
      rol: 'admin',
      correoVerificado: true,
      activo: true,
    }),
  );

  const firstLoginCaptcha = await solveCaptcha(app);
  const firstLoginResponse = await request(app.getHttpServer() as App)
    .post('/api/v1/auth/login')
    .send({ correo, password, captcha: firstLoginCaptcha });
  const { mfaToken: setupToken } = firstLoginResponse.body as {
    mfaToken: string;
  };

  const setupResponse = await request(app.getHttpServer())
    .post('/api/v1/auth/2fa/setup')
    .set('Authorization', `Bearer ${setupToken}`);
  const { otpauthUri } = setupResponse.body as { otpauthUri: string };
  const secretMatch = /secret=([^&]+)/.exec(otpauthUri);
  if (!secretMatch) {
    throw new Error('No se encontró el secreto en el otpauthUri.');
  }
  const secret = decodeURIComponent(secretMatch[1]);

  const enableResponse = await request(app.getHttpServer() as App)
    .post('/api/v1/auth/2fa/enable')
    .set('Authorization', `Bearer ${setupToken}`)
    .send({ codigo: generateTotpCode(secret, 0) });
  if (enableResponse.status !== 200) {
    throw new Error(
      `2fa/enable falló: ${enableResponse.status} ${JSON.stringify(enableResponse.body)}`,
    );
  }

  const secondLoginCaptcha = await solveCaptcha(app);
  const secondLoginResponse = await request(app.getHttpServer() as App)
    .post('/api/v1/auth/login')
    .send({ correo, password, captcha: secondLoginCaptcha });
  const { mfaToken: verifyToken } = secondLoginResponse.body as {
    mfaToken: string;
  };

  const verifyResponse = await request(app.getHttpServer() as App)
    .post('/api/v1/auth/2fa/verify')
    .send({ mfaToken: verifyToken, codigo: generateTotpCode(secret, 1) });
  if (verifyResponse.status !== 200) {
    throw new Error(
      `2fa/verify falló: ${verifyResponse.status} ${JSON.stringify(verifyResponse.body)}`,
    );
  }

  const body = verifyResponse.body as { accessToken: string };
  return {
    idUsuario: usuario.idUsuario,
    correo,
    accessToken: body.accessToken,
    totpSecret: secret,
  };
}
