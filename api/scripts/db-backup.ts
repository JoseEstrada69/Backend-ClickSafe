import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import {
  BACKUPS_DIR,
  assertNotProduction,
  readDevDbConnection,
  timestampForFilename,
  withMysqlOptionsFile,
} from './lib/dev-db-tools';

/**
 * npm run db:backup
 *
 * Respaldo lógico (mysqldump nativo) de la base de desarrollo, usando las
 * mismas credenciales que la API (api/.env, DB_*): clicksafe_api tiene
 * SELECT en todas las tablas, suficiente con --single-transaction (no
 * necesita LOCK TABLES). La contraseña nunca se imprime ni se pasa como
 * argumento de línea de comandos (`-p...`, visible en la lista de procesos
 * del sistema): se pasa por un "options file" temporal
 * (--defaults-extra-file) que se borra apenas termina, exista o no error.
 * El archivo cae en backups/ (en .gitignore, nunca se versiona).
 *
 * mysqldump.exe no siempre está en el PATH en Windows (vive en
 * "C:\Program Files\MySQL\MySQL Server 8.0\bin\" normalmente) -- si
 * MYSQLDUMP_PATH no está en api/.env, se asume que el comando "mysqldump"
 * ya resuelve solo.
 */
async function main(): Promise<void> {
  assertNotProduction('db:backup');

  let connection: ReturnType<typeof readDevDbConnection>;
  try {
    connection = readDevDbConnection();
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }

  if (!existsSync(BACKUPS_DIR)) {
    mkdirSync(BACKUPS_DIR, { recursive: true });
  }
  const fileName = `${connection.dbName}_${timestampForFilename()}.sql`;
  const filePath = join(BACKUPS_DIR, fileName);

  console.log(
    `Respaldando "${connection.dbName}" (${connection.host}:${connection.port}) con ${connection.mysqldumpPath}...`,
  );

  const exitCode = await withMysqlOptionsFile(
    connection,
    (optionsFilePath) =>
      new Promise<number>((resolve, reject) => {
        const child = spawn(
          connection.mysqldumpPath,
          [
            `--defaults-extra-file=${optionsFilePath}`,
            '--single-transaction',
            '--no-tablespaces',
            connection.dbName,
          ],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        );

        const out = createWriteStream(filePath);
        child.stdout.pipe(out);

        let stderr = '';
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });

        child.on('error', reject); // p. ej. ENOENT si el comando no existe/no está en el PATH
        child.on('close', (code) => {
          out.end(() => resolve(code ?? 1));
          if (code !== 0 && stderr.trim()) console.error(stderr.trim());
        });
      }),
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      console.error(
        `No se encontró el comando "${connection.mysqldumpPath}". ¿Está instalado MySQL Server? ` +
          'Si mysqldump no está en el PATH, fija MYSQLDUMP_PATH en api/.env (p. ej. ' +
          '"C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqldump.exe").',
      );
    } else {
      console.error('No se pudo ejecutar mysqldump:', error.message);
    }
    return -1;
  });

  if (exitCode !== 0) {
    if (existsSync(filePath)) unlinkSync(filePath);
    console.error(`mysqldump terminó con código ${exitCode}.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Listo: backups/${fileName}`);
}

void main();
