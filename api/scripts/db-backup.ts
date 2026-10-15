import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import {
  BACKUPS_DIR,
  MYSQL_CONTAINER,
  assertNotProduction,
  readDevDbCredentials,
  timestampForFilename,
} from './lib/dev-db-tools';

/**
 * npm run db:backup
 *
 * Respaldo lógico (mysqldump) de la base de desarrollo, usando el
 * contenedor de MySQL de infra/docker-compose.yml (nunca el cliente mysql
 * del host: así funciona igual sin importar si está instalado ahí). Usa
 * la contraseña de root de infra/.env (nunca se imprime: se pasa al
 * contenedor por la variable de entorno MYSQL_PWD, que mysqldump lee sin
 * que aparezca como argumento `-p...`). El archivo cae en backups/ (en
 * .gitignore, nunca se versiona).
 */
async function main(): Promise<void> {
  assertNotProduction('db:backup');

  let dbName: string;
  let rootPassword: string;
  try {
    ({ dbName, rootPassword } = readDevDbCredentials());
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }

  if (!existsSync(BACKUPS_DIR)) {
    mkdirSync(BACKUPS_DIR, { recursive: true });
  }
  const fileName = `${dbName}_${timestampForFilename()}.sql`;
  const filePath = join(BACKUPS_DIR, fileName);

  console.log(
    `Respaldando "${dbName}" desde el contenedor "${MYSQL_CONTAINER}"...`,
  );

  const child = spawn(
    'docker',
    [
      'exec',
      '-e',
      `MYSQL_PWD=${rootPassword}`,
      MYSQL_CONTAINER,
      'mysqldump',
      '-u',
      'root',
      '--single-transaction',
      '--no-tablespaces',
      dbName,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const out = createWriteStream(filePath);
  child.stdout.pipe(out);

  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on('error', reject); // p. ej. ENOENT si "docker" no está en el PATH
    child.on('close', resolve);
  }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      console.error(
        'No se encontró el comando "docker". ¿Está Docker instalado y en el PATH? ' +
          '¿Levantaste infra/docker-compose.yml?',
      );
    } else {
      console.error('No se pudo ejecutar docker exec:', error.message);
    }
    return -1;
  });

  await new Promise((resolve) => out.end(resolve));

  if (exitCode !== 0) {
    if (existsSync(filePath)) unlinkSync(filePath);
    console.error(
      `mysqldump terminó con código ${exitCode}. ¿Está corriendo el contenedor "${MYSQL_CONTAINER}" (docker compose -f infra/docker-compose.yml up -d)?`,
    );
    if (stderr.trim()) console.error(stderr.trim());
    process.exitCode = 1;
    return;
  }

  console.log(`Listo: backups/${fileName}`);
}

void main();
