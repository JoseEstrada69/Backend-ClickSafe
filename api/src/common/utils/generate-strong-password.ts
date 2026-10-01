import { randomBytes } from 'node:crypto';

/**
 * Genera una contraseña aleatoria fuerte en base64url, usando node:crypto
 * (nunca Math.random, sección 11). `byteLength` bytes de entropía producen
 * un string de ~4/3 esa longitud en caracteres, sin el sesgo de mapear
 * bytes a un alfabeto por módulo.
 */
export function generateStrongPassword(byteLength = 24): string {
  return randomBytes(byteLength).toString('base64url');
}
