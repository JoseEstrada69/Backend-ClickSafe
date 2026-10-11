import { validateEnv } from './env.schema';

describe('validateEnv', () => {
  const validConfig = {
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_MFA_SECRET: 'b'.repeat(32),
    TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    CODE_HMAC_KEY: 'c'.repeat(32),
    CAPTCHA_HMAC_KEY: 'd'.repeat(32),
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
    expect(result.THROTTLE_AUTH_LIMIT).toBe(5);
  });

  it('rechaza TOTP_ENCRYPTION_KEY que no decodifique a exactamente 32 bytes', () => {
    expect(() =>
      validateEnv({ ...validConfig, TOTP_ENCRYPTION_KEY: 'demasiado-corto' }),
    ).toThrow(/TOTP_ENCRYPTION_KEY/);
  });

  // Candado contra pruebas e2e corriendo sobre la base de desarrollo (7):
  // con NODE_ENV=test, DB_NAME tiene que ser exactamente clicksafe_test.
  it('rechaza NODE_ENV=test con DB_NAME distinto de clicksafe_test', () => {
    expect(() =>
      validateEnv({
        ...validConfig,
        NODE_ENV: 'test',
        DB_NAME: 'clicksafe_db',
      }),
    ).toThrow(/clicksafe_test/);
  });

  it('rechaza NODE_ENV=test con DB_NAME por defecto (no se fijó ninguno)', () => {
    expect(() => validateEnv({ ...validConfig, NODE_ENV: 'test' })).toThrow(
      /clicksafe_test/,
    );
  });

  it('acepta NODE_ENV=test cuando DB_NAME es clicksafe_test', () => {
    const result = validateEnv({
      ...validConfig,
      NODE_ENV: 'test',
      DB_NAME: 'clicksafe_test',
    });

    expect(result.DB_NAME).toBe('clicksafe_test');
  });

  it('no exige ninguna restricción sobre DB_NAME fuera de NODE_ENV=test', () => {
    expect(() =>
      validateEnv({
        ...validConfig,
        NODE_ENV: 'production',
        DB_NAME: 'clicksafe_db',
      }),
    ).not.toThrow();
  });
});
