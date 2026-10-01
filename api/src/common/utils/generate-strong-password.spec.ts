import { generateStrongPassword } from './generate-strong-password';

describe('generateStrongPassword', () => {
  it('genera al menos 24 caracteres por defecto', () => {
    expect(generateStrongPassword().length).toBeGreaterThanOrEqual(24);
  });

  it('nunca repite dos contraseñas seguidas', () => {
    const passwords = Array.from({ length: 20 }, () =>
      generateStrongPassword(),
    );
    expect(new Set(passwords).size).toBe(passwords.length);
  });

  it('solo usa caracteres válidos de base64url', () => {
    expect(generateStrongPassword()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
