import { hashPassword, verifyPassword } from './password-hash';

describe('password-hash', () => {
  it('produce un hash Argon2id verificable con la contraseña correcta', async () => {
    const hash = await hashPassword('una-contraseña-de-prueba');

    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(
      verifyPassword(hash, 'una-contraseña-de-prueba'),
    ).resolves.toBe(true);
  });

  it('rechaza una contraseña incorrecta', async () => {
    const hash = await hashPassword('una-contraseña-de-prueba');

    await expect(verifyPassword(hash, 'otra-contraseña')).resolves.toBe(false);
  });
});
