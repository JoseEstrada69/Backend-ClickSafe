import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import {
  BACKUPS_DIR,
  MYSQL_CONTAINER,
  assertNotProduction,
  readDevDbCredentials,
} from './lib/dev-db-tools';

/**
 * npm run db:restore -- <archivo> --confirm
 *
 * Restaura un respaldo de npm run db:backup dentro del contenedor de MySQL
 * de infra/docker-compose.yml. SOBRESCRIBE la base de desarrollo completa:
 * por eso exige la bandera --confirm explícita (igual que
 * cleanup:zap -- --confirm) en vez de coregir nada sin que se pida a
 * propósito. <archivo> puede ser un nombre dentro de backups/ o una ruta
 * completa. La contraseña de root nunca se imprime (MYSQL_PWD, como en
 * db-backup.ts).
 */
async function main(): Promise<void> {
  assertNotProduction('db:restore');

  const args = process.argv.slice(2);
  const confirm = args.includes('--confirm');
  const fileArg = args.find((a) => !a.startsWith('--'));

  if (!fileArg) {
    console.error(
      'Falta el archivo a restaurar. Uso: npm run db:restore -- <archivo> --confirm',
    );
    process.exitCode = 1;
    return;
  }

  const filePath = isAbsolute(fileArg) ? fileArg : join(BACKUPS_DIR, fileArg);
  if (!existsSync(filePath)) {
    console.error(`No existe el archivo: ${filePath}`);
    process.exitCode = 1;
    return;
  }

  let dbName: string;
  let rootPassword: string;
  try {
    ({ dbName, rootPassword } = readDevDbCredentials());
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }

  if (!confirm) {
    console.log(
      `Esto SOBRESCRIBIRÍA por completo la base "${dbName}" con el contenido de ${filePath}.\n` +
        'No se tocó nada. Vuelve a correr con --confirm para aplicarlo:\n' +
        `  npm run db:restore -- ${fileArg} --confirm`,
    );
    return;
  }

  console.log(
    `Restaurando "${dbName}" desde ${filePath} en el contenedor "${MYSQL_CONTAINER}"...`,
  );

  const child = spawn(
    'docker',
    [
      'exec',
      '-i',
      '-e',
      `MYSQL_PWD=${rootPassword}`,
      MYSQL_CONTAINER,
      'mysql',
      '-u',
      'root',
      dbName,
    ],
    { stdio: ['pipe', 'inherit', 'pipe'] },
  );

  createReadStream(filePath).pipe(child.stdin);

  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on('error', reject);
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

  if (exitCode !== 0) {
    console.error(`mysql terminó con código ${exitCode}.`);
    if (stderr.trim()) console.error(stderr.trim());
    process.exitCode = 1;
    return;
  }

  console.log('Listo: restauración aplicada.');
}

void main();
