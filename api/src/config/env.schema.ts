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

const baseEnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  // Interfaz donde escucha la API (4.1). Opcional a propósito: sin fijarla,
  // se conserva el comportamiento de siempre (127.0.0.1 en producción,
  // 0.0.0.0 en desarrollo) -- ver main.ts. Solo hace falta fijarla cuando la
  // topología real no coincide con esa suposición (p. ej. un laboratorio sin
  // Nginx, donde la API debe exponerse directo a la red aunque
  // NODE_ENV=production). Validada como IPv4 o IPv6 real, nunca un hostname.
  HOST: z.union([z.ipv4(), z.ipv6()]).optional(),

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

  // Firma los mfaToken (5.4/5.5). Nunca debe ser igual a JWT_ACCESS_SECRET.
  JWT_MFA_SECRET: z
    .string()
    .min(32, 'JWT_MFA_SECRET debe tener al menos 32 caracteres'),

  // Cifra el secreto TOTP (AES-256-GCM) antes de guardarlo (5.5). Debe
  // decodificar, en base64, a exactamente 32 bytes.
  TOTP_ENCRYPTION_KEY: z.string().refine((value) => {
    try {
      return Buffer.from(value, 'base64').length === 32;
    } catch {
      return false;
    }
  }, 'TOTP_ENCRYPTION_KEY debe ser 32 bytes en base64 (usa randomBytes(32).toString("base64"))'),

  // HMAC de los códigos de verificación/recuperación (5.3/5.7).
  CODE_HMAC_KEY: z
    .string()
    .min(32, 'CODE_HMAC_KEY debe tener al menos 32 caracteres'),

  // HMAC del reto proof-of-work del captcha (5.2).
  CAPTCHA_HMAC_KEY: z
    .string()
    .min(32, 'CAPTCHA_HMAC_KEY debe tener al menos 32 caracteres'),

  // Firma las URLs de evidencias (sección 6, punto 8): HMAC-SHA256(id:exp).
  EVIDENCE_URL_SECRET: z
    .string()
    .min(32, 'EVIDENCE_URL_SECRET debe tener al menos 32 caracteres'),

  // Rate limit global (4.4): 100 peticiones/minuto por IP (o por usuario si hay token).
  THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60_000),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),

  // Rate limit de /auth/* (4.4): 5 peticiones/minuto por IP.
  THROTTLE_AUTH_TTL_MS: z.coerce.number().int().positive().default(60_000),
  THROTTLE_AUTH_LIMIT: z.coerce.number().int().positive().default(5),

  // Rate limit de creación de reportes (4.4): 10/hora por usuario.
  THROTTLE_REPORTS_TTL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(3_600_000),
  THROTTLE_REPORTS_LIMIT: z.coerce.number().int().positive().default(10),

  // Rate limit de comentarios (4.4): 30/hora por usuario.
  THROTTLE_COMMENTS_TTL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(3_600_000),
  THROTTLE_COMMENTS_LIMIT: z.coerce.number().int().positive().default(30),

  // Rate limit de denuncias de comentarios (4.4): 20/hora por usuario.
  THROTTLE_FLAGS_TTL_MS: z.coerce.number().int().positive().default(3_600_000),
  THROTTLE_FLAGS_LIMIT: z.coerce.number().int().positive().default(20),

  // Conexión a MySQL (2): la API se conecta como `clicksafe_api`, nunca como root.
  DB_HOST: z.string().min(1).default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USERNAME: z.string().min(1).default('clicksafe_api'),
  DB_PASSWORD: z.string().min(1, 'DB_PASSWORD es obligatorio'),
  DB_NAME: z.string().min(1).default('clicksafe_db'),
  // Tamaño del pool de conexiones mysql2. Sin fijarlo explícitamente, el
  // driver usa su propio valor por defecto (10) sin que quede documentado
  // en ningún lado del proyecto. Una carga concurrente alta (p. ej. un
  // escaneo activo contra varias rutas a la vez) satura ese pool más
  // rápido de lo que parece razonable para la API real; subirlo y dejarlo
  // explícito reduce esa contención (docs/seguridad.md).
  DB_POOL_SIZE: z.coerce.number().int().positive().default(20),

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

  // Usado solo por scripts/seed-demo.ts. Por defecto, ese script se niega a
  // correr si NODE_ENV=production -- la protección real es no sembrar datos
  // de prueba sobre un despliegue de producción de verdad. Pero un
  // laboratorio sin Nginx (ver .env.lab.example) también usa
  // NODE_ENV=production a propósito (para que HOST/SWAGGER_ENABLED/etc. se
  // comporten como producción), así que ahí sí hace falta poder sembrar
  // datos de demo. ALLOW_DEMO_SEED=true es ese permiso explícito y aparte:
  // nunca se activa "por accidente" solo por estar en NODE_ENV=production.
  ALLOW_DEMO_SEED: booleanFromEnv('false'),
});

/**
 * Candado contra pruebas e2e corriendo sobre la base de desarrollo (7): con
 * NODE_ENV=test (lo pone Jest automáticamente si no se fija antes), DB_NAME
 * debe ser EXACTAMENTE 'clicksafe_test'. Si alguien corre `test:e2e` sin
 * `.env.test` o con uno mal configurado, la API ni siquiera arranca — las
 * pruebas nunca llegan a tocar clicksafe_db.
 */
export const envSchema = baseEnvSchema.refine(
  (config) => config.NODE_ENV !== 'test' || config.DB_NAME === 'clicksafe_test',
  {
    message:
      "Con NODE_ENV=test, DB_NAME debe ser exactamente 'clicksafe_test' (nunca la base de desarrollo). Revisa api/.env.test.",
    path: ['DB_NAME'],
  },
);

export type EnvConfig = z.infer<typeof baseEnvSchema>;

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
