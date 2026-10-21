import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

export interface DevDbConnection {
  host: string;
  port: string;
  username: string;
  password: string;
  dbName: string;
  /** Ruta a mysqldump.exe/mysqldump. Si no está en api/.env, se asume que el comando ya está en el PATH. */
  mysqldumpPath: string;
  /** Ruta a mysql.exe/mysql. Igual que arriba. */
  mysqlPath: string;
}

/**
 * Credenciales de MySQL nativo (scripts de npm, nunca de bash/PowerShell
 * -- deben correr igual en Git Bash y PowerShell). Usa las MISMAS
 * credenciales que la API (api/.env, DB_*): clicksafe_api
 * tiene SELECT en todas las tablas, suficiente para un respaldo lógico con
 * --single-transaction (no necesita LOCK TABLES). MYSQLDUMP_PATH/MYSQL_PATH
 * son opcionales -- en Windows, mysqldump.exe/mysql.exe normalmente NO
 * están en el PATH (viven en
 * "C:\Program Files\MySQL\MySQL Server 8.0\bin\"), así que sin esas
 * variables se asume que el comando ya está en el PATH y se usa su nombre
 * simple ("mysqldump"/"mysql").
 */
export function readDevDbConnection(): DevDbConnection {
  const env = readEnvFile(join(REPO_ROOT, 'api', '.env'));

  const dbName = env.DB_NAME;
  const username = env.DB_USERNAME;
  const password = env.DB_PASSWORD;
  if (!dbName || !username || !password) {
    throw new Error(
      'Faltan DB_NAME/DB_USERNAME/DB_PASSWORD en api/.env. ¿Copiaste api/.env.example a api/.env?',
    );
  }

  return {
    host: env.DB_HOST || '127.0.0.1',
    port: env.DB_PORT || '3306',
    username,
    password,
    dbName,
    mysqldumpPath: env.MYSQLDUMP_PATH || 'mysqldump',
    mysqlPath: env.MYSQL_PATH || 'mysql',
  };
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
  return date.toISOString().replaceAll(':', '-').replace(/\..+/, '');
}

/**
 * Crea un "options file" temporal de MySQL (sección `[client]` con host,
 * puerto, usuario y contraseña) y devuelve su ruta junto con una función
 * para borrarlo. mysqldump/mysql lo leen con `--defaults-extra-file`, que
 * es la forma documentada de pasarles una contraseña sin que aparezca como
 * argumento `-p...` (visible en la lista de procesos del sistema) ni se
 * imprima en ningún lado. Se crea en un directorio temporal nuevo (no en
 * backups/ ni en el repo) y SIEMPRE se borra, incluso si el comando falla.
 */
export async function withMysqlOptionsFile<T>(
  connection: DevDbConnection,
  run: (optionsFilePath: string) => Promise<T>,
): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'clicksafe-mysql-opts-'));
  const optionsFilePath = join(dir, 'my.cnf');
  try {
    writeFileSync(
      optionsFilePath,
      [
        '[client]',
        `host=${connection.host}`,
        `port=${connection.port}`,
        `user=${connection.username}`,
        `password=${connection.password}`,
        '',
      ].join('\n'),
      { mode: 0o600 },
    );
    return await run(optionsFilePath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
