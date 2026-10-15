import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AuditService } from '../src/audit/audit.service';
import { AppConfigService } from '../src/config/app-config.service';
import { CATALOG_NAME_PATTERN } from '../src/common/validators/catalog-name.validator';
import { CategoriaFraude, Plataforma, Reporte } from '../src/database/entities';

/**
 * npm run cleanup:zap -- [--confirm]
 *
 * Borra SOLO de la base de DESARROLLO las filas de Plataforma/Categoria_fraude
 * que dejó un escaneo activo (p. ej. OWASP ZAP) antes de que el nombre tuviera
 * una lista blanca de caracteres (IsCatalogName, catalog-name.validator.ts).
 *
 * Qué cuenta como "basura del escaneo": cualquier fila cuyo `nombre` NO pasa
 * el whitelist actual. Es la misma validación que ya rechaza esos nombres en
 * POST/PATCH /admin/platforms y /admin/categories desde ahora, así que una
 * fila que no la cumple no pudo haberse creado por la API después del fix:
 * es necesariamente anterior a él. No se usa ninguna lista de patrones de
 * ZAP en particular (comillas, "chr(", URLs, "John Doe", etc.): cualquier
 * caracter fuera de la lista blanca basta.
 *
 * Reglas de seguridad (pedidas explícitamente, no se negocian):
 *  - Se niega a correr si NODE_ENV no es exactamente "development".
 *  - Nunca toca la plataforma "Otra" (es_otra = TRUE): aunque su nombre
 *    nunca podría fallar el whitelist, se excluye explícitamente igual.
 *  - Nunca borra una fila que SÍ usa algún Reporte real (fk_reporte_plataforma
 *    / fk_reporte_categoria son RESTRICT: el borrado fallaría solo, pero se
 *    detecta antes para no intentarlo ni listarlo como borrado).
 *  - Nunca toca Usuario, Reporte, Comentario, Denuncia_comentario ni
 *    Bitacora_auditoria (bitácora es, además, solo INSERT/SELECT para el
 *    usuario de BD de la API — ver database/clicksafe_db.sql sección 6).
 *  - Sin "--confirm" solo IMPRIME qué borraría (modo de solo lectura);
 *    nada se borra hasta que se pase esa bandera explícitamente.
 *  - Lo que sí borra, lo deja escrito en Bitacora_auditoria
 *    (accion: catalogo_modificado, detalle.via: "cleanup:zap") para que quede
 *    registro de que la limpieza ocurrió y qué tocó.
 */
async function run(): Promise<void> {
  const confirm = process.argv.includes('--confirm');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const appConfig = app.get(AppConfigService);
    if (appConfig.nodeEnv !== 'development') {
      console.error(
        `Este script solo corre con NODE_ENV=development (actual: "${appConfig.nodeEnv}"). Abortado.`,
      );
      process.exitCode = 1;
      return;
    }

    const plataformaRepo = app.get<Repository<Plataforma>>(
      getRepositoryToken(Plataforma),
    );
    const categoriaRepo = app.get<Repository<CategoriaFraude>>(
      getRepositoryToken(CategoriaFraude),
    );
    const reporteRepo = app.get<Repository<Reporte>>(
      getRepositoryToken(Reporte),
    );
    const auditService = app.get(AuditService);

    const [plataformas, categorias] = await Promise.all([
      plataformaRepo.find(),
      categoriaRepo.find(),
    ]);

    const plataformasBasura = plataformas.filter(
      (p) => !p.esOtra && !CATALOG_NAME_PATTERN.test(p.nombre),
    );
    const categoriasBasura = categorias.filter(
      (c) => !CATALOG_NAME_PATTERN.test(c.nombre),
    );

    console.log(
      `Candidatas: ${plataformasBasura.length} plataformas, ${categoriasBasura.length} categorías (nombre fuera de la lista blanca).`,
    );

    const plataformasABorrar: Plataforma[] = [];
    const plataformasEnUso: { fila: Plataforma; reportes: number[] }[] = [];
    for (const p of plataformasBasura) {
      const reportes = await reporteRepo.find({
        where: { idPlataforma: p.idPlataforma },
        select: { idReporte: true },
      });
      if (reportes.length > 0) {
        plataformasEnUso.push({
          fila: p,
          reportes: reportes.map((r) => r.idReporte),
        });
      } else {
        plataformasABorrar.push(p);
      }
    }

    const categoriasABorrar: CategoriaFraude[] = [];
    const categoriasEnUso: { fila: CategoriaFraude; reportes: number[] }[] = [];
    for (const c of categoriasBasura) {
      const reportes = await reporteRepo.find({
        where: { idCategoria: c.idCategoria },
        select: { idReporte: true },
      });
      if (reportes.length > 0) {
        categoriasEnUso.push({
          fila: c,
          reportes: reportes.map((r) => r.idReporte),
        });
      } else {
        categoriasABorrar.push(c);
      }
    }

    console.log(
      `\n=== Plataformas que ${confirm ? 'se van a borrar' : 'se borrarían'} (${plataformasABorrar.length}) ===`,
    );
    for (const p of plataformasABorrar) {
      console.log(` id=${p.idPlataforma} nombre=${JSON.stringify(p.nombre)}`);
    }

    console.log(
      `\n=== Categorías que ${confirm ? 'se van a borrar' : 'se borrarían'} (${categoriasABorrar.length}) ===`,
    );
    for (const c of categoriasABorrar) {
      console.log(` id=${c.idCategoria} nombre=${JSON.stringify(c.nombre)}`);
    }

    console.log(
      `\n=== Plataformas NO borradas por estar en uso de algún reporte real (${plataformasEnUso.length}) ===`,
    );
    for (const { fila, reportes } of plataformasEnUso) {
      console.log(
        ` id=${fila.idPlataforma} nombre=${JSON.stringify(fila.nombre)} reportes=[${reportes.join(', ')}]`,
      );
    }

    console.log(
      `\n=== Categorías NO borradas por estar en uso de algún reporte real (${categoriasEnUso.length}) ===`,
    );
    for (const { fila, reportes } of categoriasEnUso) {
      console.log(
        ` id=${fila.idCategoria} nombre=${JSON.stringify(fila.nombre)} reportes=[${reportes.join(', ')}]`,
      );
    }

    if (!confirm) {
      console.log(
        '\nModo de solo lectura: no se borró nada. Vuelve a correr con "npm run cleanup:zap -- --confirm" para borrar lo listado arriba.',
      );
      return;
    }

    if (plataformasABorrar.length > 0) {
      await plataformaRepo.delete(
        plataformasABorrar.map((p) => p.idPlataforma),
      );
    }
    if (categoriasABorrar.length > 0) {
      await categoriaRepo.delete(categoriasABorrar.map((c) => c.idCategoria));
    }

    await auditService.log({
      idUsuario: null,
      accion: 'catalogo_modificado',
      resultado: 'exito',
      recursoTipo: 'Plataforma',
      recursoId: null,
      detalle: {
        via: 'cleanup:zap',
        accion: 'borrar',
        plataformasBorradas: plataformasABorrar.map((p) => p.idPlataforma),
        categoriasBorradas: categoriasABorrar.map((c) => c.idCategoria),
      },
    });

    console.log(
      `\nListo: se borraron ${plataformasABorrar.length} plataformas y ${categoriasABorrar.length} categorías.`,
    );
  } finally {
    await app.close();
  }
}

void run();
