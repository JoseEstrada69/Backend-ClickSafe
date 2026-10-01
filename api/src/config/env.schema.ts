import { z } from 'zod';

/**
 * Convierte valores típicos de .env ("true"/"false") a boolean real.
 * Cualquier otro valor se rechaza explícitamente (no se asume falsy).
 */
const booleanFromEnv = (defaultValue: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(defaultValue)
    .transform((value) => value === 'true');

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  // CORS deshabilitado por defecto (4.1): solo se habilita si hay orígenes explícitos.
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),

  // Solo debe ser true detrás de un proxy real (Nginx); si no, X-Forwarded-For
  // se puede falsificar y evadir el rate limiting (4.1).
  TRUST_PROXY: booleanFromEnv('false'),

  // En producción, exponer Swagger da un mapa gratis al atacante (4.1).
  SWAGGER_ENABLED: booleanFromEnv('false'),

  // Firma los access tokens (HS256). Mínimo 32 bytes en base64 (~44 caracteres).
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET debe tener al menos 32 caracteres'),
  JWT_ISSUER: z.string().min(1).default('clicksafe-api'),
  JWT_AUDIENCE: z.string().min(1).default('clicksafe-app'),

  // Rate limit global (4.4): 100 peticiones/minuto por IP (o por usuario si hay token).
  THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60_000),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),

  // Conexión a MySQL (2): la API se conecta como `clicksafe_api`, nunca como root.
  DB_HOST: z.string().min(1).default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USERNAME: z.string().min(1).default('clicksafe_api'),
  DB_PASSWORD: z.string().min(1, 'DB_PASSWORD es obligatorio'),
  DB_NAME: z.string().min(1).default('clicksafe_db'),

  // Correo vía Mailpit en desarrollo (1, regla 12) — sin servicios externos.
  MAIL_HOST: z.string().min(1).default('127.0.0.1'),
  MAIL_PORT: z.coerce.number().int().positive().default(1025),
  MAIL_FROM: z.string().min(1).default('ClickSafe <no-reply@clicksafe.local>'),

  // Carpeta de evidencias, fuera de la carpeta del código (sección 6).
  STORAGE_DIR: z.string().min(1).default('../storage'),

  // Usados solo por scripts/seed-admin.ts; opcionales para que el resto de
  // la API arranque sin ellos (se validan al correr el script, no aquí).
  SEED_ADMIN_NOMBRE: z.string().min(1).optional(),
  SEED_ADMIN_CORREO: z.string().email().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Usado por ConfigModule.forRoot({ validate }). Si falta o es inválida una
 * variable, la API no arranca. El mensaje solo indica QUÉ variable falla,
 * nunca su valor (evita filtrar secretos parciales al log de arranque).
 */
export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Configuración de entorno inválida. Revisa: ${problems}`);
  }
  return result.data;
}
