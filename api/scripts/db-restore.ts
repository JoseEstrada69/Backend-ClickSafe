import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import {
  BACKUPS_DIR,
  assertNotProduction,
  readDevDbConnection,
  withMysqlOptionsFile,
} from './lib/dev-db-tools';

/**
 * npm run db:restore -- <archivo> --confirm
 *
 * Restaura un respaldo de npm run db:backup con el cliente mysql nativo.
 * SOBRESCRIBE la base de desarrollo: por eso exige --confirm explícito
 * (igual que cleanup:zap -- --confirm) en vez de hacer nada sin que se
 * pida a propósito. <archivo> puede ser un nombre dentro de backups/ o una
 * ruta completa. La contraseña nunca se imprime (mismo options file
 * temporal que db-backup.ts).
 *
 * OJO -- limitación real, no cosmética: un dump de mysqldump por defecto
 * incluye DROP TABLE + CREATE TABLE antes de los INSERT de cada tabla.
 * clicksafe_api es de mínimo privilegio (solo SELECT/INSERT/UPDATE/DELETE
 * según la tabla, sin DROP ni CREATE en ninguna -- database/clicksafe_db.sql
 * sección 6), así que restaurar sobre una base que YA tiene esas tablas
 * fallará con un error de permisos en el DROP/CREATE de cada una. Esto solo
 * sirve hoy para restaurar sobre una base recién creada (vacía, sin esas
 * tablas todavía) con esas mismas credenciales. Restaurar encima de una
 * base ya poblada necesita credenciales con privilegios de DDL (p. ej.
 * root), que este script a propósito no usa porque no se pidieron.
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

  let connection: ReturnType<typeof readDevDbConnection>;
  try {
    connection = readDevDbConnection();
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }

  if (!confirm) {
    console.log(
      `Esto SOBRESCRIBIRÍA por completo la base "${connection.dbName}" con el contenido de ${filePath}.\n` +
        'No se tocó nada. Vuelve a correr con --confirm para aplicarlo:\n' +
        `  npm run db:restore -- ${fileArg} --confirm`,
    );
    return;
  }

  console.log(
    `Restaurando "${connection.dbName}" (${connection.host}:${connection.port}) desde ${filePath} con ${connection.mysqlPath}...`,
  );

  const exitCode = await withMysqlOptionsFile(
    connection,
    (optionsFilePath) =>
      new Promise<number>((resolve, reject) => {
        const child = spawn(
          connection.mysqlPath,
          [`--defaults-extra-file=${optionsFilePath}`, connection.dbName],
          { stdio: ['pipe', 'inherit', 'pipe'] },
        );

        createReadStream(filePath).pipe(child.stdin);

        let stderr = '';
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });

        child.on('error', reject);
        child.on('close', (code) => {
          if (code !== 0 && stderr.trim()) console.error(stderr.trim());
          resolve(code ?? 1);
        });
      }),
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      console.error(
        `No se encontró el comando "${connection.mysqlPath}". ¿Está instalado MySQL Server? ` +
          'Si mysql no está en el PATH, fija MYSQL_PATH en api/.env (p. ej. ' +
          String.raw`"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe").`,
      );
    } else {
      console.error('No se pudo ejecutar mysql:', error.message);
    }
    return -1;
  });

  if (exitCode !== 0) {
    console.error(`mysql terminó con código ${exitCode}.`);
    process.exitCode = 1;
    return;
  }

  console.log('Listo: restauración aplicada.');
}

void main();
