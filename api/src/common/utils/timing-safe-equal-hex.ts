import { timingSafeEqual } from 'node:crypto';

/**
 * Compara dos strings hexadecimales en tiempo constante. Nunca usar `===`
 * para comparar hashes/firmas/códigos (sección 11): filtraría cuánto
 * coinciden por cuánto tarda la comparación.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  let bufferA: Buffer;
  let bufferB: Buffer;
  try {
    bufferA = Buffer.from(a, 'hex');
    bufferB = Buffer.from(b, 'hex');
  } catch {
    return false;
  }
  if (bufferA.length !== bufferB.length || bufferA.length === 0) {
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}
