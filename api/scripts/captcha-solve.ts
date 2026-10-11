import { createHash } from 'node:crypto';

/**
 * npm run captcha:solve — herramienta de desarrollo para probar en Swagger.
 *
 * Pide un reto real a GET /auth/captcha, lo resuelve por fuerza bruta (el
 * mismo trabajo que haría el cliente/app) y arma el payload en base64 que
 * se pega en el campo `captcha` de cualquier endpoint que lo exija.
 *
 * Esto NO modifica la API ni agrega ningún atajo para saltarse el
 * captcha: el reto se resuelve de verdad contra el servidor que esté
 * corriendo (npm run start:dev), exactamente como lo haría un cliente
 * legítimo. Si el servidor no está arriba, este script falla igual que
 * fallaría cualquier otro cliente.
 */

const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000/api/v1';

interface CaptchaChallenge {
  algorithm: 'SHA-256';
  challenge: string;
  maxnumber: number;
  salt: string;
  signature: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function solve(challenge: CaptchaChallenge): number {
  for (let number = 0; number <= challenge.maxnumber; number++) {
    if (sha256(challenge.salt + number.toString()) === challenge.challenge) {
      return number;
    }
  }
  throw new Error(
    `No se encontró un número solución entre 0 y ${challenge.maxnumber}. ` +
      '¿El servidor cambió el protocolo del captcha?',
  );
}

async function run(): Promise<void> {
  const url = `${BASE_URL}/auth/captcha`;
  console.log(`Pidiendo reto a ${url} ...`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `GET /auth/captcha respondió ${response.status}. ¿Está corriendo "npm run start:dev"?`,
    );
  }
  const challenge = (await response.json()) as CaptchaChallenge;

  const number = solve(challenge);
  const payload = {
    algorithm: challenge.algorithm,
    challenge: challenge.challenge,
    number,
    salt: challenge.salt,
    signature: challenge.signature,
  };
  const captcha = Buffer.from(JSON.stringify(payload)).toString('base64');

  console.log(`Resuelto: number=${number}`);
  console.log('\nPega este valor en el campo "captcha" de Swagger:\n');
  console.log(captcha);
  console.log(
    '\n(Vale solo una vez y expira en 5 minutos — resuelve uno nuevo para cada petición.)',
  );
}

run().catch((err: unknown) => {
  console.error('ERROR:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
