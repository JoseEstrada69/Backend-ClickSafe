import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import sharp from 'sharp';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AppConfigService } from '../src/config/app-config.service';
import { generateStrongPassword } from '../src/common/utils/generate-strong-password';
import { hashPassword } from '../src/common/utils/password-hash';
import { ImageProcessingService } from '../src/evidences/image-processing.service';
import { STORAGE_SERVICE } from '../src/storage/storage.service.interface';
import type { StorageService } from '../src/storage/storage.service.interface';
import {
  CategoriaFraude,
  Comentario,
  DenunciaComentario,
  Evidencia,
  EstadoReporte,
  LikeReporte,
  Notificacion,
  Plataforma,
  Reporte,
  RevisionReporte,
  Usuario,
} from '../src/database/entities';

const DEMO_EMAIL_SUFFIX = '@demo.clicksafe.local';
const TOTAL_REPORTES_NORMALES = 23;

/**
 * npm run seed:demo. Llena la base configurada en el .env normal de la API
 * (el mismo usuario clicksafe_api, vía NestFactory.createApplicationContext)
 * con datos de ejemplo para la demo y para probar el panel de admin.
 *
 * Idempotente POR ELEMENTO (no "todo o nada"): cada usuario demo se busca
 * por `correo`, cada reporte demo se busca por `titulo` exacto. Si ya
 * existe, se reutiliza tal cual y no se vuelve a tocar -- nunca se borra ni
 * se actualiza nada. Solo se crea lo que falta, y al final se imprime qué
 * se creó y qué ya existía. Corrarlo varias veces es seguro: la segunda vez
 * no debería crear nada nuevo.
 *
 * Se niega a correr si NODE_ENV=production (esto es solo para
 * desarrollo/laboratorio). NUNCA crea un admin nuevo (sería una vía no
 * documentada de volverse admin, sección 1): usa el admin que ya exista de
 * `npm run seed:admin` para autoría de las revisiones de ejemplo.
 */

interface ResultadoElemento {
  etiqueta: string;
  creado: boolean;
}

interface ReporteDemoSpec {
  titulo: string;
  descripcion: string;
  urlPublicacion: string;
  estado: EstadoReporte;
  anonimo: boolean;
  monthsAgo: number;
  conEvidencia: boolean;
  conComentarios: boolean;
}

/** Fecha UTC hace `monthsAgo` meses, en vez de `new Date()` (sección 7, admin/stats > porMes). */
function fechaHaceMeses(monthsAgo: number, day: number, hour: number): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, day, hour),
  );
}

/** Imagen simple (no una foto real): un rectángulo de color distinto por reporte, suficiente para probar el pipeline de evidencias. */
async function buildDemoImage(seed: number): Promise<Buffer> {
  const r = (seed * 37) % 256;
  const g = (seed * 83) % 256;
  const b = (seed * 151) % 256;
  return sharp({
    create: { width: 320, height: 240, channels: 3, background: { r, g, b } },
  })
    .png()
    .toBuffer();
}

function buildReportesSpec(): ReporteDemoSpec[] {
  const escenarios = [
    'No llegó mi pedido después de 3 semanas',
    'Me vendieron un producto falsificado',
    'El vendedor desapareció después del pago',
    'Cobro duplicado en mi tarjeta',
    'El producto no coincide con las fotos',
    'Perfil falso haciéndose pasar por tienda oficial',
    'Enlace de pago que parece phishing',
    'Precio ridículamente bajo como gancho',
    'Cargo extra no autorizado al confirmar compra',
    'Producto llegó dañado y no responden',
    'Me pidieron pagar por fuera de la plataforma',
    'El "soporte" pedía datos de la tarjeta por chat',
  ];

  const specs: ReporteDemoSpec[] = [];
  for (let i = 0; i < TOTAL_REPORTES_NORMALES; i++) {
    const estado: EstadoReporte =
      i < 8 ? 'pendiente' : i < 18 ? 'validado' : 'rechazado';
    specs.push({
      titulo: `[Demo ${String(i + 1).padStart(2, '0')}] ${escenarios[i % escenarios.length]}`,
      descripcion:
        'Descripción de ejemplo generada por npm run seed:demo. Este ' +
        'reporte no corresponde a un caso real, es solo para pruebas.',
      urlPublicacion: `https://tienda-ejemplo.demo/producto-${i + 1}`,
      estado,
      anonimo: i % 4 === 0,
      monthsAgo: 11 - Math.floor((i * 12) / TOTAL_REPORTES_NORMALES),
      conEvidencia: i % 3 === 0,
      conComentarios: i < 10,
    });
  }

  // Los 2 reportes "trampa" para probar el panel (sección de admin-web):
  // se insertan directo por repositorio, nunca por POST /reports -- la API
  // pública rechazaría la segunda URL (disallow_auth, 4.8) a propósito.
  specs.push({
    titulo: '<img src=x onerror=alert(1)>',
    descripcion:
      'Reporte de prueba: el panel nunca debe interpretar el título como ' +
      'HTML (4.7, nunca se sanitiza porque nunca se renderiza como tal).',
    urlPublicacion: 'https://tienda-ejemplo.demo/producto-xss',
    estado: 'pendiente',
    anonimo: false,
    monthsAgo: 0,
    conEvidencia: false,
    conComentarios: false,
  });
  specs.push({
    titulo: '[Demo trampa] URL que aparenta ser de Mercado Libre',
    descripcion:
      'Reporte de prueba con una URL "usuario:contraseña@host" que ' +
      'aparenta un dominio legítimo. La API pública la rechazaría al crear ' +
      'un reporte real (disallow_auth, 4.8); aquí se inserta directo para ' +
      'confirmar que el panel no la muestra como si fuera un link válido.',
    urlPublicacion: 'https://mercadolibre.com.mx@estafa.example',
    estado: 'pendiente',
    anonimo: false,
    monthsAgo: 0,
    conEvidencia: false,
    conComentarios: false,
  });

  return specs;
}

async function run(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const appConfig = app.get(AppConfigService);
    if (appConfig.isProduction) {
      console.error(
        'NODE_ENV=production: seed:demo es solo para desarrollo/laboratorio. No se creó nada.',
      );
      process.exitCode = 1;
      return;
    }

    const usuarioRepo = app.get<Repository<Usuario>>(
      getRepositoryToken(Usuario),
    );
    const plataformaRepo = app.get<Repository<Plataforma>>(
      getRepositoryToken(Plataforma),
    );
    const categoriaRepo = app.get<Repository<CategoriaFraude>>(
      getRepositoryToken(CategoriaFraude),
    );
    const reporteRepo = app.get<Repository<Reporte>>(
      getRepositoryToken(Reporte),
    );
    const comentarioRepo = app.get<Repository<Comentario>>(
      getRepositoryToken(Comentario),
    );
    const denunciaRepo = app.get<Repository<DenunciaComentario>>(
      getRepositoryToken(DenunciaComentario),
    );
    const likeRepo = app.get<Repository<LikeReporte>>(
      getRepositoryToken(LikeReporte),
    );
    const notificacionRepo = app.get<Repository<Notificacion>>(
      getRepositoryToken(Notificacion),
    );
    const revisionRepo = app.get<Repository<RevisionReporte>>(
      getRepositoryToken(RevisionReporte),
    );
    const evidenciaRepo = app.get<Repository<Evidencia>>(
      getRepositoryToken(Evidencia),
    );
    const imageProcessing = app.get(ImageProcessingService);
    const storageService = app.get<StorageService>(STORAGE_SERVICE);

    const admin = await usuarioRepo.findOne({
      where: { rol: 'admin', activo: true },
      order: { idUsuario: 'ASC' },
    });
    if (!admin) {
      console.error(
        'No hay ningún admin activo. Corre primero `npm run seed:admin` y vuelve a intentar.',
      );
      process.exitCode = 1;
      return;
    }

    // --- Usuarios: find-or-create por correo (estable entre corridas) ---
    const nombresUsuarios = ['Ana García', 'Luis Fernández', 'María Torres'];
    const usuarios: Usuario[] = [];
    const usuariosResultado: ResultadoElemento[] = [];
    const passwordsNuevas: { correo: string; password: string }[] = [];

    for (let i = 0; i < nombresUsuarios.length; i++) {
      const correo = `demo.usuario${i + 1}${DEMO_EMAIL_SUFFIX}`;
      const existente = await usuarioRepo.findOne({ where: { correo } });
      if (existente) {
        usuarios.push(existente);
        usuariosResultado.push({ etiqueta: correo, creado: false });
        continue;
      }
      const password = generateStrongPassword(18);
      const nuevo = await usuarioRepo.save(
        usuarioRepo.create({
          nombre: nombresUsuarios[i],
          correo,
          correoVerificado: true,
          passwordHash: await hashPassword(password),
          rol: 'usuario',
          activo: true,
        }),
      );
      usuarios.push(nuevo);
      usuariosResultado.push({ etiqueta: correo, creado: true });
      passwordsNuevas.push({ correo, password });
    }

    // --- Catálogos ya existentes (database/clicksafe_db.sql) ---
    const plataformas = await plataformaRepo.find({ where: { activa: true } });
    const otra = plataformas.find((p) => p.esOtra);
    const normales = plataformas.filter((p) => !p.esOtra);
    const categorias = await categoriaRepo.find({ where: { activa: true } });
    if (normales.length === 0 || !otra || categorias.length === 0) {
      throw new Error(
        'Faltan catálogos (Plataforma/Categoria_fraude). ¿Corriste database/clicksafe_db.sql?',
      );
    }

    // --- Reportes: find-or-create por título (estable entre corridas) ---
    const reportesSpec = buildReportesSpec();
    const reportesResultado: ResultadoElemento[] = [];
    const comentariosNuevos: Comentario[] = [];
    let evidenciasCreadas = 0;
    let comentariosCreados = 0;
    let likesCreados = 0;

    const textosComentario = [
      'A mí me pasó algo parecido con la misma tienda.',
      '¿Alguien más tuvo este problema?',
      'Gracias por reportarlo, me salvaste de comprar ahí.',
      'Yo sí pude recuperar mi dinero contactando al banco.',
      'Esto debería estar prohibido, qué mal.',
    ];

    for (let i = 0; i < reportesSpec.length; i++) {
      const spec = reportesSpec[i];
      const existente = await reporteRepo.findOne({
        where: { titulo: spec.titulo },
      });
      if (existente) {
        reportesResultado.push({ etiqueta: spec.titulo, creado: false });
        continue;
      }

      const autor = usuarios[i % usuarios.length];
      const esOtraPlataforma = i % 7 === 0;
      const plataforma = esOtraPlataforma
        ? otra
        : normales[i % normales.length];
      const categoria = categorias[i % categorias.length];
      const fecha = fechaHaceMeses(spec.monthsAgo, 5 + (i % 20), 9 + (i % 10));

      const reporte = await reporteRepo.save(
        reporteRepo.create({
          idUsuario: autor.idUsuario,
          idPlataforma: plataforma.idPlataforma,
          plataformaOtra: esOtraPlataforma ? 'Tienda de ejemplo' : null,
          idCategoria: categoria.idCategoria,
          titulo: spec.titulo,
          descripcion: spec.descripcion,
          urlPublicacion: spec.urlPublicacion,
          anonimo: spec.anonimo,
          estado: spec.estado,
          fechaCreacion: fecha,
          fechaActualizacion: fecha,
        }),
      );
      reportesResultado.push({ etiqueta: spec.titulo, creado: true });

      if (spec.estado !== 'pendiente') {
        await revisionRepo.save(
          revisionRepo.create({
            idReporte: reporte.idReporte,
            idAdministrador: admin.idUsuario,
            decision: spec.estado,
            comentario:
              spec.estado === 'validado'
                ? 'Caso verificado, evidencia suficiente.'
                : 'No se pudo verificar la denuncia.',
          }),
        );
        await notificacionRepo.save(
          notificacionRepo.create({
            idUsuario: autor.idUsuario,
            idReporte: reporte.idReporte,
            tipo:
              spec.estado === 'validado'
                ? 'reporte_validado'
                : 'reporte_rechazado',
            mensaje:
              spec.estado === 'validado'
                ? 'Tu reporte fue validado.'
                : 'Tu reporte fue rechazado.',
          }),
        );
      }

      if (spec.conEvidencia) {
        const cantidad = i % 6 === 0 ? 2 : 1;
        for (let e = 0; e < cantidad; e++) {
          const raw = await buildDemoImage(reporte.idReporte * 10 + e);
          const processed = await imageProcessing.process(raw);
          const fileName = imageProcessing.generateFileName();
          const relativePath = imageProcessing.buildRelativePath(
            fileName,
            fecha,
          );
          await storageService.save(relativePath, processed.buffer);
          await evidenciaRepo.save(
            evidenciaRepo.create({
              idReporte: reporte.idReporte,
              nombreArchivo: fileName,
              rutaArchivo: relativePath,
              tipoArchivo: imageProcessing.tipoArchivo,
              tamanoBytes: processed.sizeBytes,
              hashSha256: processed.sha256,
            }),
          );
          evidenciasCreadas++;
        }
      }

      if (spec.conComentarios) {
        for (let j = 0; j < 2; j++) {
          const comentador = usuarios[(i + j + 1) % usuarios.length];
          const comentario = await comentarioRepo.save(
            comentarioRepo.create({
              idReporte: reporte.idReporte,
              idUsuario: comentador.idUsuario,
              contenido: textosComentario[(i + j) % textosComentario.length],
              anonimo: j === 1,
            }),
          );
          comentariosNuevos.push(comentario);
          comentariosCreados++;
          if (comentador.idUsuario !== autor.idUsuario) {
            await notificacionRepo.save(
              notificacionRepo.create({
                idUsuario: autor.idUsuario,
                idReporte: reporte.idReporte,
                tipo: 'nuevo_comentario',
                mensaje: 'Tu reporte recibió un nuevo comentario.',
              }),
            );
          }
        }
      }

      // Likes de 2 usuarios distintos del autor (determinístico, sin Math.random, sección 11).
      const otrosUsuarios = usuarios.filter(
        (u) => u.idUsuario !== autor.idUsuario,
      );
      for (const usuario of otrosUsuarios.slice(0, 2)) {
        await likeRepo.save(
          likeRepo.create({
            idUsuario: usuario.idUsuario,
            idReporte: reporte.idReporte,
          }),
        );
        await reporteRepo.increment(
          { idReporte: reporte.idReporte },
          'totalLikes',
          1,
        );
        likesCreados++;
      }
    }

    // --- Denuncias (sección 1 regla 6): solo sobre comentarios NUEVOS de
    // esta corrida -- si ya existían de una corrida anterior, ya deben
    // tener sus denuncias y no hay que duplicarlas. Con solo 3 usuarios
    // demo, el admin cuenta como el 3er denunciante distinto cuando hace
    // falta (nada impide que un admin denuncie un comentario). ---
    let denunciasCreadas = 0;
    if (comentariosNuevos.length > 0) {
      const comentarioAOcultar = comentariosNuevos[0];
      const denunciantesParaOcultar = [
        ...usuarios.filter((u) => u.idUsuario !== comentarioAOcultar.idUsuario),
        admin,
      ]
        .filter((u) => u.idUsuario !== comentarioAOcultar.idUsuario)
        .slice(0, 3);
      for (const denunciante of denunciantesParaOcultar) {
        await denunciaRepo.save(
          denunciaRepo.create({
            idComentario: comentarioAOcultar.idComentario,
            idUsuario: denunciante.idUsuario,
            motivo: 'spam',
          }),
        );
        denunciasCreadas++;
      }
      await comentarioRepo.update(
        { idComentario: comentarioAOcultar.idComentario },
        {
          estado: 'oculto_auto',
          totalDenuncias: denunciantesParaOcultar.length,
        },
      );
    }
    if (comentariosNuevos.length > 1) {
      const comentarioConUnaDenuncia = comentariosNuevos[1];
      const denunciante = [admin, ...usuarios].find(
        (u) => u.idUsuario !== comentarioConUnaDenuncia.idUsuario,
      );
      if (denunciante) {
        await denunciaRepo.save(
          denunciaRepo.create({
            idComentario: comentarioConUnaDenuncia.idComentario,
            idUsuario: denunciante.idUsuario,
            motivo: 'lenguaje_ofensivo',
            detalle: 'Comentario de ejemplo marcado para la demo.',
          }),
        );
        denunciasCreadas++;
        await comentarioRepo.update(
          { idComentario: comentarioConUnaDenuncia.idComentario },
          { totalDenuncias: 1 },
        );
      }
    }

    // --- Resumen ---
    console.log('--- Usuarios demo ---');
    for (const { etiqueta, creado } of usuariosResultado) {
      console.log(`  [${creado ? 'creado' : 'ya existía'}] ${etiqueta}`);
    }
    if (passwordsNuevas.length > 0) {
      console.log(
        '  Contraseñas de los usuarios recién creados (solo se muestran aquí):',
      );
      for (const { correo, password } of passwordsNuevas) {
        console.log(`    ${correo}  /  ${password}`);
      }
    }

    console.log('--- Reportes demo ---');
    for (const { etiqueta, creado } of reportesResultado) {
      console.log(`  [${creado ? 'creado' : 'ya existía'}] ${etiqueta}`);
    }

    const nuevosReportes = reportesResultado.filter((r) => r.creado).length;
    console.log('--- Resumen de esta corrida ---');
    console.log(
      `  Reportes nuevos: ${nuevosReportes} de ${reportesResultado.length} (el resto ya existía)`,
    );
    console.log(`  Evidencias nuevas: ${evidenciasCreadas}`);
    console.log(`  Comentarios nuevos: ${comentariosCreados}`);
    console.log(`  Likes nuevos: ${likesCreados}`);
    console.log(`  Denuncias nuevas: ${denunciasCreadas}`);
    console.log(
      `  Autor de las revisiones de ejemplo: ${admin.correo} (admin ya existente)`,
    );
  } finally {
    await app.close();
  }
}

void run();
