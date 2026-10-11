import { randomInt } from 'node:crypto';

/** Código numérico de `digits` dígitos, generado con node:crypto (nunca Math.random, sección 11). */
export function generateNumericCode(digits: number): string {
  const max = 10 ** digits;
  const value = randomInt(0, max);
  return value.toString().padStart(digits, '0');
}
