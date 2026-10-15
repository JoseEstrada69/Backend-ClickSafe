import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Nombre fijo en infra/docker-compose.yml. Si lo renombras ahí, renómbralo aquí también. */
export const MYSQL_CONTAINER = 'clicksafe-mysql';

export const REPO_ROOT = join(__dirname, '..', '..', '..');
export const BACKUPS_DIR = join(REPO_ROOT, 'backups');

/** Parser mínimo de archivos .env (KEY=VALUE), sin dependencias nuevas. */
export function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const result: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    result[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return result;
}

export interface DevDbCredentials {
  dbName: string;
  rootPassword: string;
}

/**
 * Credenciales para hablar con el contenedor de MySQL de
 * infra/docker-compose.yml: el nombre de la base viene de api/.env
 * (DB_NAME) y la contraseña de root de infra/.env (MYSQL_ROOT_PASSWORD) —
 * nunca la de clicksafe_api, porque mysqldump/mysql necesitan permisos que
 * ese usuario de mínimo privilegio no tiene (p. ej. LOCK TABLES).
 */
export function readDevDbCredentials(): DevDbCredentials {
  const apiEnv = readEnvFile(join(REPO_ROOT, 'api', '.env'));
  const infraEnv = readEnvFile(join(REPO_ROOT, 'infra', '.env'));

  const dbName = apiEnv.DB_NAME;
  const rootPassword = infraEnv.MYSQL_ROOT_PASSWORD;

  if (!dbName) {
    throw new Error(
      'No se encontró DB_NAME en api/.env. ¿Copiaste api/.env.example a api/.env?',
    );
  }
  if (!rootPassword) {
    throw new Error(
      'No se encontró MYSQL_ROOT_PASSWORD en infra/.env. ¿Copiaste infra/.env.example a infra/.env y levantaste infra/docker-compose.yml?',
    );
  }

  return { dbName, rootPassword };
}

/** NODE_ENV se lee de api/.env (igual que lo usa la API); nunca de process.env solo, para no depender de cómo se invocó el script. */
export function readNodeEnv(): string {
  const apiEnv = readEnvFile(join(REPO_ROOT, 'api', '.env'));
  return apiEnv.NODE_ENV ?? process.env.NODE_ENV ?? 'development';
}

export function assertNotProduction(scriptName: string): void {
  const nodeEnv = readNodeEnv();
  if (nodeEnv === 'production') {
    console.error(
      `${scriptName} está bloqueado con NODE_ENV=production. Este comando es solo para desarrollo.`,
    );
    process.exit(1);
  }
}

/** Timestamp sin ":" (Windows no acepta ":" en nombres de archivo). */
export function timestampForFilename(date: Date = new Date()): string {
  return date.toISOString().replace(/:/g, '-').replace(/\..+/, '');
}
