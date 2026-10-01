import * as argon2 from 'argon2';

/**
 * Argon2id con los parámetros mínimos recomendados por OWASP (sección 2).
 * Centralizado aquí para que el seed del admin y el login/registro (Fase 3)
 * nunca diverjan en estos valores.
 */
const ARGON2ID_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2ID_OPTIONS);
}

export function verifyPassword(
  hash: string,
  password: string,
): Promise<boolean> {
  return argon2.verify(hash, password);
}
