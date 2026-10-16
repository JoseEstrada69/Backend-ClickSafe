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
 * Limpia SOLO la base de DESARROLLO de las filas de Plataforma/Categoria_fraude
 * que dejó un escaneo activo (p. ej. OWASP ZAP con sesión de admin) antes de
 * que el nombre tuviera una lista blanca de caracteres (IsCatalogName,
 * catalog-name.validator.ts). "Limpia" = DESACTIVA (activa = FALSE), nunca
 * DELETE: el usuario de BD de la API (clicksafe_api) no tiene permiso DELETE
 * sobre Plataforma ni Categoria_fraude (confirmado con SHOW GRANTS), y de
 * cualquier forma la sección 1 regla 10 de CLAUDE.md ya es explícita: estos
 * catálogos no se borran, se desactivan. Desactivar alcanza para resolver el
 * problema real (que ensucien lo que ve la app iOS): GET /platforms y
 * GET /categories, los que usa la app, solo devuelven activa = TRUE.
 *
 * Qué cuenta como "basura del escaneo", en dos pasadas:
 *  1. Cualquier nombre que YA NO pase la lista blanca actual. Como esa
 *     validación ahora rechaza esos caracteres en la API, una fila que no
 *     la cumple es necesariamente anterior al fix.
 *  2. Un pequeño conjunto de nombres EXACTOS que sí usan solo caracteres de
 *     la lista blanca pero que el inventario identificó igual como basura
 *     del escaneo (p. ej. "John Doe", "www.google.com", el dominio de
 *     *.owasp.org sin símbolos, "ZAP", "get-help"). A propósito es una
 *     coincidencia EXACTA contra esta lista curada, no un patrón ni "todo lo
 *     que no esté en el .sql": así nunca se confunde con un nombre legítimo
 *     nuevo (p. ej. una plataforma real que alguien cree después) ni con
 *     datos de prueba propios como "Prueba ClickSafe Editada" (visto en el
 *     inventario, con su propio historial real de catalogo_modificado).
 *
 * Reglas de seguridad (pedidas explícitamente, no se negocian):
 *  - Se niega a correr si NODE_ENV no es exactamente "development".
 *  - Nunca toca la plataforma "Otra" (es_otra = TRUE) ni los 14
 *    Plataforma/8 Categoria_fraude del .sql (por nombre exacto).
 *  - Antes de desactivar una fila usada por algún Reporte real, la
 *    REASIGNA a un catálogo legítimo del .sql (determinista: el id del
 *    reporte módulo la cantidad de catálogos legítimos), nunca la deja
 *    "huérfana" ni intenta desactivar con reportes aún apuntando ahí.
 *  - No toca Usuario, Comentario, Denuncia_comentario ni Bitacora_auditoria.
 *  - Sin "--confirm" solo IMPRIME qué reasignaría/desactivaría (modo de solo
 *    lectura); nada cambia hasta que se pase esa bandera explícitamente.
 *  - Lo que sí cambia, lo deja en Bitacora_auditoria (catalogo_modificado,
 *    detalle.via: "cleanup:zap") como evidencia de que la limpieza ocurrió.
 */

const KNOWN_PLATFORMS = [
  'Mercado Libre',
  'Amazon México',
  'Facebook Marketplace',
  'Instagram',
  'TikTok Shop',
  'Shein',
  'Temu',
  'AliExpress',
  'Walmart',
  'Liverpool',
  'Coppel',
  'eBay',
  'WhatsApp',
  'Otra',
];
const KNOWN_CATEGORIES = [
  'Producto no entregado',
  'Producto falsificado',
  'Producto distinto al anunciado',
  'Vendedor falso o suplantación',
  'Sitio o enlace fraudulento',
  'Cobro no autorizado',
  'Precio engañoso',
  'Otro',
];

/** Pase 2 (sección de arriba): coincidencia exacta, no patrón. */
const EXACT_JUNK_NAMES = new Set([
  'John Doe',
  "John Doe'",
  "John Doe'(",
  "'",
  "'(",
  'John Doe UNION ALL select NULL --',
  "John Doe' UNION ALL select NULL --",
  'John Doe) UNION ALL select NULL --',
  "John Doe') UNION ALL select NULL --",
  'John Doe&sleep 15.0&',
  "John Doe'&sleep 15.0&'",
  'get-help',
  'ZAP',
  'www.google.com',
  '2838109406003807913.owasp.org',
]);

function isJunkName(nombre: string, knownNames: string[]): boolean {
  if (knownNames.includes(nombre)) return false;
  if (!CATALOG_NAME_PATTERN.test(nombre)) return true; // pase 1
  return EXACT_JUNK_NAMES.has(nombre); // pase 2
}

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

    const [todasPlataformas, todasCategorias] = await Promise.all([
      plataformaRepo.find(),
      categoriaRepo.find(),
    ]);

    const plataformasLegitimas = todasPlataformas.filter(
      (p) => !p.esOtra && KNOWN_PLATFORMS.includes(p.nombre),
    );
    const categoriasLegitimas = todasCategorias.filter((c) =>
      KNOWN_CATEGORIES.includes(c.nombre),
    );
    if (plataformasLegitimas.length === 0 || categoriasLegitimas.length === 0) {
      console.error(
        'No se encontraron los catálogos del .sql (¿se corrió clicksafe_db.sql?). Abortado.',
      );
      process.exitCode = 1;
      return;
    }

    const plataformasBasura = todasPlataformas.filter(
      (p) => !p.esOtra && isJunkName(p.nombre, KNOWN_PLATFORMS),
    );
    const categoriasBasura = todasCategorias.filter((c) =>
      isJunkName(c.nombre, KNOWN_CATEGORIES),
    );

    console.log(
      `Basura detectada: ${plataformasBasura.length} plataformas, ${categoriasBasura.length} categorías.`,
    );

    // --- Reasignaciones necesarias antes de poder desactivar ---
    interface Reasignacion {
      idReporte: number;
      campo: 'idPlataforma' | 'idCategoria';
      deId: number;
      deNombre: string;
      aId: number;
      aNombre: string;
    }
    const reasignaciones: Reasignacion[] = [];

    for (const p of plataformasBasura) {
      const reportes = await reporteRepo.find({
        where: { idPlataforma: p.idPlataforma },
        select: { idReporte: true },
      });
      for (const r of reportes) {
        const destino =
          plataformasLegitimas[r.idReporte % plataformasLegitimas.length];
        reasignaciones.push({
          idReporte: r.idReporte,
          campo: 'idPlataforma',
          deId: p.idPlataforma,
          deNombre: p.nombre,
          aId: destino.idPlataforma,
          aNombre: destino.nombre,
        });
      }
    }
    for (const c of categoriasBasura) {
      const reportes = await reporteRepo.find({
        where: { idCategoria: c.idCategoria },
        select: { idReporte: true },
      });
      for (const r of reportes) {
        const destino =
          categoriasLegitimas[r.idReporte % categoriasLegitimas.length];
        reasignaciones.push({
          idReporte: r.idReporte,
          campo: 'idCategoria',
          deId: c.idCategoria,
          deNombre: c.nombre,
          aId: destino.idCategoria,
          aNombre: destino.nombre,
        });
      }
    }

    console.log(
      `\n=== Reportes que se ${confirm ? 'van a reasignar' : 'reasignarían'} a un catálogo legítimo (${reasignaciones.length}) ===`,
    );
    for (const r of reasignaciones) {
      console.log(
        ` reporte=${r.idReporte} ${r.campo}: ${r.deId} (${JSON.stringify(r.deNombre)}) -> ${r.aId} (${JSON.stringify(r.aNombre)})`,
      );
    }

    console.log(
      `\n=== Plataformas que se ${confirm ? 'van a desactivar' : 'desactivarían'} (${plataformasBasura.length}) ===`,
    );
    for (const p of plataformasBasura) {
      console.log(` id=${p.idPlataforma} nombre=${JSON.stringify(p.nombre)}`);
    }

    console.log(
      `\n=== Categorías que se ${confirm ? 'van a desactivar' : 'desactivarían'} (${categoriasBasura.length}) ===`,
    );
    for (const c of categoriasBasura) {
      console.log(` id=${c.idCategoria} nombre=${JSON.stringify(c.nombre)}`);
    }

    if (!confirm) {
      console.log(
        '\nModo de solo lectura: no se cambió nada. Vuelve a correr con "npm run cleanup:zap -- --confirm" para aplicar lo listado arriba.',
      );
      return;
    }

    // Secuencial a propósito (no Promise.all): es un script de limpieza
    // destructivo sobre datos reales de desarrollo -- mejor una escritura a
    // la vez, con salida determinista, que muchos UPDATE simultáneos.
    for (const r of reasignaciones) {
      // NOSONAR: await intencional dentro del loop, ver comentario de arriba.
      await reporteRepo.update(
        { idReporte: r.idReporte },
        { [r.campo]: r.aId },
      );
    }

    if (plataformasBasura.length > 0) {
      await plataformaRepo.update(
        plataformasBasura.map((p) => p.idPlataforma),
        { activa: false },
      );
    }
    if (categoriasBasura.length > 0) {
      await categoriaRepo.update(
        categoriasBasura.map((c) => c.idCategoria),
        { activa: false },
      );
    }

    await auditService.log({
      idUsuario: null,
      accion: 'catalogo_modificado',
      resultado: 'exito',
      recursoTipo: 'Plataforma',
      recursoId: null,
      detalle: {
        via: 'cleanup:zap',
        accion: 'desactivar',
        reasignaciones,
        plataformasDesactivadas: plataformasBasura.map((p) => p.idPlataforma),
        categoriasDesactivadas: categoriasBasura.map((c) => c.idCategoria),
      },
    });

    console.log(
      `\nListo: ${reasignaciones.length} reportes reasignados; ${plataformasBasura.length} plataformas y ${categoriasBasura.length} categorías desactivadas.`,
    );
  } finally {
    await app.close();
  }
}

void run();
