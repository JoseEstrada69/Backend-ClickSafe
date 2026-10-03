import { authenticator } from 'otplib';

const STEP_SECONDS = 30;
const TOLERANCE_STEPS = 1; // ±1 paso (5.5)

authenticator.options = {
  step: STEP_SECONDS,
  digits: 6,
  window: TOLERANCE_STEPS,
};

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function totpKeyUri(
  accountName: string,
  issuer: string,
  secret: string,
): string {
  return authenticator.keyuri(accountName, issuer, secret);
}

function currentCounter(): number {
  return Math.floor(Date.now() / 1000 / STEP_SECONDS);
}

export interface TotpVerifyResult {
  valid: boolean;
  counter: number;
}

/**
 * Verifica un código TOTP con ventana de tolerancia ±1 paso y rechaza
 * cualquier contador <= al último usado (un código TOTP solo se puede
 * usar una vez, 5.5).
 *
 * Se apoya en `authenticator.checkDelta`, que ya decodifica el secreto
 * base32 correctamente y devuelve cuántos pasos de diferencia hubo con el
 * código recibido. No se usa `hotp` directamente: copiar las opciones de
 * `authenticator` hacia `hotp` NO migra su decodificador base32 interno,
 * así que `hotp.check` calculaba una clave HMAC distinta y nunca coincidía.
 */
export function verifyTotpCode(
  code: string,
  secret: string,
  lastUsedCounter: number | null,
): TotpVerifyResult {
  const current = currentCounter();
  const delta = authenticator.checkDelta(code, secret);

  if (delta === null) {
    return { valid: false, counter: current };
  }

  const counter = current + delta;
  if (lastUsedCounter !== null && counter <= lastUsedCounter) {
    return { valid: false, counter };
  }

  return { valid: true, counter };
}
