import { createHash, createHmac } from 'node:crypto';
import { Repository } from 'typeorm';
import { AppConfigService } from '../config/app-config.service';
import { CaptchaUsado } from '../database/entities';
import { CaptchaChallengeResponse } from './dto/captcha-challenge-response.dto';
import { CaptchaService } from './captcha.service';

const HMAC_KEY = 'clave-de-prueba-para-captcha-123456789012';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(value: string): string {
  return createHmac('sha256', HMAC_KEY).update(value).digest('hex');
}

/** Reconstruye un reto como lo haría el servicio, con una expiración elegida por la prueba. */
function buildChallenge(expiresInSeconds: number): CaptchaChallengeResponse {
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const salt = `0123456789ab?expires=${expires}`;
  const number = 42;
  const challenge = sha256(salt + number.toString());
  const signature = hmac(challenge);
  return {
    algorithm: 'SHA-256',
    challenge,
    maxnumber: 100_000,
    salt,
    signature,
  };
}

function bruteForce(challenge: CaptchaChallengeResponse): number {
  for (let i = 0; i <= challenge.maxnumber; i++) {
    if (sha256(challenge.salt + i.toString()) === challenge.challenge) {
      return i;
    }
  }
  throw new Error('No se encontró número solución en la prueba');
}

function encodePayload(
  challenge: CaptchaChallengeResponse,
  number: number,
  overrides: Partial<Record<string, unknown>> = {},
): string {
  const payload = {
    algorithm: challenge.algorithm,
    challenge: challenge.challenge,
    number,
    salt: challenge.salt,
    signature: challenge.signature,
    ...overrides,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

describe('CaptchaService', () => {
  let service: CaptchaService;
  let store: Map<string, Date>;

  beforeEach(() => {
    store = new Map();
    const appConfig = {
      captchaHmacKey: HMAC_KEY,
    } as unknown as AppConfigService;
    const repo = {
      insert: jest.fn((entity: { firma: string; expiraEn: Date }) => {
        if (store.has(entity.firma)) {
          return Promise.reject(new Error('ER_DUP_ENTRY'));
        }
        store.set(entity.firma, entity.expiraEn);
        return Promise.resolve({});
      }),
    };
    service = new CaptchaService(
      appConfig,
      repo as unknown as Repository<CaptchaUsado>,
    );
  });

  it('crea un reto con el formato esperado', () => {
    const challenge = service.createChallenge();

    expect(challenge.algorithm).toBe('SHA-256');
    expect(challenge.challenge).toMatch(/^[0-9a-f]{64}$/);
    expect(challenge.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(challenge.salt).toMatch(/\?expires=\d+$/);
  });

  it('acepta un captcha resuelto correctamente', async () => {
    const challenge = buildChallenge(300);
    const number = bruteForce(challenge);
    const payload = encodePayload(challenge, number);

    await expect(service.verify(payload)).resolves.toBe(true);
  });

  it('rechaza el mismo captcha dos veces (ataque de repetición)', async () => {
    const challenge = buildChallenge(300);
    const number = bruteForce(challenge);
    const payload = encodePayload(challenge, number);

    await expect(service.verify(payload)).resolves.toBe(true);
    await expect(service.verify(payload)).resolves.toBe(false);
  });

  it('rechaza un captcha expirado', async () => {
    const challenge = buildChallenge(-10); // expiró hace 10 segundos
    const number = bruteForce(challenge);
    const payload = encodePayload(challenge, number);

    await expect(service.verify(payload)).resolves.toBe(false);
  });

  it('rechaza una firma manipulada', async () => {
    const challenge = buildChallenge(300);
    const number = bruteForce(challenge);
    const payload = encodePayload(challenge, number, {
      signature: '0'.repeat(64),
    });

    await expect(service.verify(payload)).resolves.toBe(false);
  });

  it('rechaza un número que no resuelve el reto', async () => {
    const challenge = buildChallenge(300);
    const payload = encodePayload(challenge, 999_999 % challenge.maxnumber);

    await expect(service.verify(payload)).resolves.toBe(false);
  });

  it('rechaza un payload que no es JSON base64 válido', async () => {
    await expect(service.verify('esto-no-es-base64-json')).resolves.toBe(false);
  });
});
