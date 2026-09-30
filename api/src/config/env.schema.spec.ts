import { validateEnv } from './env.schema';

describe('validateEnv', () => {
  const validConfig = {
    JWT_ACCESS_SECRET: 'a'.repeat(32),
  };

  it('acepta una configuración válida y aplica los valores por defecto', () => {
    const result = validateEnv(validConfig);

    expect(result.NODE_ENV).toBe('development');
    expect(result.PORT).toBe(3000);
    expect(result.CORS_ORIGINS).toEqual([]);
    expect(result.TRUST_PROXY).toBe(false);
    expect(result.SWAGGER_ENABLED).toBe(false);
    expect(result.THROTTLE_LIMIT).toBe(100);
  });

  it('separa y limpia CORS_ORIGINS por comas', () => {
    const result = validateEnv({
      ...validConfig,
      CORS_ORIGINS: 'https://a.com, https://b.com ,,',
    });

    expect(result.CORS_ORIGINS).toEqual(['https://a.com', 'https://b.com']);
  });

  it('rechaza el arranque si falta JWT_ACCESS_SECRET (no expone valores en el mensaje)', () => {
    expect(() => validateEnv({})).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('rechaza JWT_ACCESS_SECRET más corto que 32 caracteres', () => {
    expect(() => validateEnv({ JWT_ACCESS_SECRET: 'demasiado-corto' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('rechaza NODE_ENV con un valor fuera de la lista permitida', () => {
    expect(() =>
      validateEnv({ ...validConfig, NODE_ENV: 'staging' }),
    ).toThrow();
  });
});
