import { authenticator } from 'otplib';
import { generateTotpSecret, totpKeyUri, verifyTotpCode } from './totp';

describe('totp', () => {
  it('genera un secreto base32 y un otpauth:// URI válido', () => {
    const secret = generateTotpSecret();
    const uri = totpKeyUri('ana@clicksafe.local', 'ClickSafe', secret);

    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
  });

  it('acepta el código actual generado por authenticator', () => {
    const secret = generateTotpSecret();
    const code = authenticator.generate(secret);

    const result = verifyTotpCode(code, secret, null);

    expect(result.valid).toBe(true);
  });

  it('rechaza un código incorrecto', () => {
    const secret = generateTotpSecret();

    const result = verifyTotpCode('000000', secret, null);

    expect(result.valid).toBe(false);
  });

  it('rechaza el mismo código reutilizado (contador <= al último usado)', () => {
    const secret = generateTotpSecret();
    const code = authenticator.generate(secret);

    const first = verifyTotpCode(code, secret, null);
    expect(first.valid).toBe(true);

    const second = verifyTotpCode(code, secret, first.counter);
    expect(second.valid).toBe(false);
  });

  it('acepta un código generado un paso (30s) en el pasado (tolerancia ±1)', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now - 30_000);
    const pastCode = authenticator.generate(secret);
    jest.spyOn(Date, 'now').mockReturnValue(now);

    const result = verifyTotpCode(pastCode, secret, null);

    expect(result.valid).toBe(true);
    jest.restoreAllMocks();
  });

  it('rechaza un código de hace dos pasos (fuera de la tolerancia ±1)', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now - 60_000);
    const oldCode = authenticator.generate(secret);
    jest.spyOn(Date, 'now').mockReturnValue(now);

    const result = verifyTotpCode(oldCode, secret, null);

    expect(result.valid).toBe(false);
    jest.restoreAllMocks();
  });
});
