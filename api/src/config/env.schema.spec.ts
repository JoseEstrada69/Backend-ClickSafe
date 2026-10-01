import { validateEnv } from './env.schema';

describe('validateEnv', () => {
  const validConfig = {
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    DB_PASSWORD: 'db-password-de-prueba',
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

  it('rechaza el arranque si falta DB_PASSWORD', () => {
    expect(() => validateEnv({ JWT_ACCESS_SECRET: 'a'.repeat(32) })).toThrow(
      /DB_PASSWORD/,
    );
  });

  it('aplica los valores por defecto de BD, correo y almacenamiento', () => {
    const result = validateEnv(validConfig);

    expect(result.DB_HOST).toBe('127.0.0.1');
    expect(result.DB_PORT).toBe(3306);
    expect(result.DB_USERNAME).toBe('clicksafe_api');
    expect(result.DB_NAME).toBe('clicksafe_db');
    expect(result.MAIL_HOST).toBe('127.0.0.1');
    expect(result.MAIL_PORT).toBe(1025);
    expect(result.STORAGE_DIR).toBe('../storage');
    expect(result.SEED_ADMIN_NOMBRE).toBeUndefined();
  });
});
