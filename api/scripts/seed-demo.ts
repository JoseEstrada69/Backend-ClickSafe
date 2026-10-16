import { randomBytes } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import sharp from 'sharp';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AppConfigService } from '../src/config/app-config.service';
import { generateStrongPassword } from '../src/common/utils/generate-strong-password';
import { hashPassword } from '../src/common/utils/password-hash';
import { CATALOG_NAME_PATTERN } from '../src/common/validators/catalog-name.validator';
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
  MotivoDenuncia,
  Notificacion,
  Plataforma,
  Reporte,
  RevisionReporte,
  Usuario,
} from '../src/database/entities';

const DEMO_EMAIL_SUFFIX = '@demo.clicksafe.local';
const TOTAL_REPORTES_NORMALES = 23;
const TOTAL_USUARIOS_NORMALES = 23; // > 20 en total (sección 7, panel de admin, Fase 4).

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
 * Se niega a correr si NODE_ENV=production, salvo que ALLOW_DEMO_SEED=true
 * (p. ej. un laboratorio sin Nginx que por lo demás necesita
 * NODE_ENV=production para que HOST/SWAGGER_ENABLED/etc. se comporten como
 * producción, ver .env.lab.example) -- la protección real es no sembrar
 * datos de prueba sobre un despliegue de producción de verdad, nunca el
 * valor de NODE_ENV por sí solo. Usa el admin que ya exista de `npm run
 * seed:admin` para autoría de las revisiones de ejemplo, y además crea un
 * SEGUNDO admin de demo (contraseña aleatoria inutilizable, igual que
 * POST /admin/admins) para poder probar el panel con más de un admin --
 * a diferencia del resto del script, esto es una excepción deliberada:
 * normalmente ningún script de seed debe poder crear admins (sección 1),
 * pero aquí se pidió explícitamente para la demo del panel.
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
    if (appConfig.isProduction && !appConfig.allowDemoSeed) {
      console.error(
        'NODE_ENV=production sin ALLOW_DEMO_SEED=true: seed:demo no corre aquí. No se creó nada.',
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
    const nombresUsuarios = [
      'Ana García',
      'Luis Fernández',
      'María Torres',
      'Carlos Ruiz',
      'Sofía Hernández',
      'Jorge Martínez',
      'Valentina López',
      'Diego Ramírez',
      'Camila Flores',
      'Andrés Gómez',
      'Paula Díaz',
      'Fernando Castro',
      'Daniela Morales',
      'Ricardo Ortiz',
      'Gabriela Vargas',
      'Sebastián Rojas',
      'Isabel Reyes',
      'Emilio Navarro',
      'Renata Chávez',
      'Mateo Mendoza',
      'Lucía Guerrero',
      'Tomás Silva',
      'Ximena Campos',
    ];
    const usuarios: Usuario[] = [];
    const usuariosResultado: ResultadoElemento[] = [];
    const passwordsNuevas: { correo: string; password: string }[] = [];

    for (let i = 0; i < TOTAL_USUARIOS_NORMALES; i++) {
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
          nombre: nombresUsuarios[i % nombresUsuarios.length],
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

    // El último usuario de la lista queda suspendido, para poder probar el
    // panel con un usuario inactivo. Idempotente: si ya estaba suspendido
    // de una corrida anterior, no hace nada (ni lo reactiva ni lo audita
    // de nuevo).
    const usuarioASuspender = usuarios[usuarios.length - 1];
    let usuarioSuspendidoEstaCorrida = false;
    if (usuarioASuspender.activo) {
      await usuarioRepo.update(usuarioASuspender.idUsuario, {
        activo: false,
      });
      usuarioASuspender.activo = false;
      usuarioSuspendidoEstaCorrida = true;
    }

    // --- Segundo admin de demo: contraseña inutilizable, igual que
    // POST /admin/admins (sección 8/7). Nunca se le manda correo de
    // recuperación aquí (el script no depende de que Mailpit esté
    // corriendo) -- quien quiera entrar con esta cuenta usa
    // /auth/forgot-password a mano. ---
    const SEGUNDO_ADMIN_CORREO = `demo.admin2${DEMO_EMAIL_SUFFIX}`;
    let segundoAdmin = await usuarioRepo.findOne({
      where: { correo: SEGUNDO_ADMIN_CORREO },
    });
    let segundoAdminCreado = false;
    if (!segundoAdmin) {
      segundoAdmin = await usuarioRepo.save(
        usuarioRepo.create({
          nombre: 'Admin Demo Dos',
          correo: SEGUNDO_ADMIN_CORREO,
          correoVerificado: true,
          passwordHash: await hashPassword(randomBytes(32).toString('hex')),
          rol: 'admin',
          activo: true,
        }),
      );
      segundoAdminCreado = true;
    }

    // --- Catálogos ya existentes (database/clicksafe_db.sql) ---
    // Solo nombres que pasan la lista blanca (IsCatalogName): un escaneo
    // activo (OWASP ZAP) demostró que la API aceptaba cualquier texto como
    // nombre de catálogo antes de ese validador, dejando cientos de filas
    // de prueba activas. Sin este filtro, este seed las repartiría entre
    // los reportes de demo igual que si fueran catálogos reales.
    const plataformasTodas = await plataformaRepo.find({
      where: { activa: true },
    });
    const plataformas = plataformasTodas.filter(
      (p) => p.esOtra || CATALOG_NAME_PATTERN.test(p.nombre),
    );
    const otra = plataformas.find((p) => p.esOtra);
    const normales = plataformas.filter((p) => !p.esOtra);
    const categoriasTodas = await categoriaRepo.find({
      where: { activa: true },
    });
    const categorias = categoriasTodas.filter((c) =>
      CATALOG_NAME_PATTERN.test(c.nombre),
    );
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

    // --- Reporte dedicado a probar moderación de comentarios (Fase 4):
    // find-or-create por título, igual que los demás reportes. ---
    const MODERATION_REPORT_TITLE =
      '[Demo moderación] Reporte para probar denuncias y moderación de comentarios';
    let moderationReport = await reporteRepo.findOne({
      where: { titulo: MODERATION_REPORT_TITLE },
    });
    if (!moderationReport) {
      const fechaModeracion = fechaHaceMeses(1, 10, 10);
      moderationReport = await reporteRepo.save(
        reporteRepo.create({
          idUsuario: usuarios[0].idUsuario,
          idPlataforma: normales[0].idPlataforma,
          plataformaOtra: null,
          idCategoria: categorias[0].idCategoria,
          titulo: MODERATION_REPORT_TITLE,
          descripcion:
            'Reporte de ejemplo dedicado a probar la moderación de ' +
            'comentarios (demo, Fase 4). No corresponde a un caso real.',
          urlPublicacion: 'https://tienda-ejemplo.demo/producto-moderacion',
          anonimo: false,
          estado: 'validado',
          fechaCreacion: fechaModeracion,
          fechaActualizacion: fechaModeracion,
        }),
      );
      reportesResultado.push({
        etiqueta: MODERATION_REPORT_TITLE,
        creado: true,
      });
      await revisionRepo.save(
        revisionRepo.create({
          idReporte: moderationReport.idReporte,
          idAdministrador: admin.idUsuario,
          decision: 'validado',
          comentario: 'Caso verificado, evidencia suficiente.',
        }),
      );
    } else {
      reportesResultado.push({
        etiqueta: MODERATION_REPORT_TITLE,
        creado: false,
      });
    }

    // find-or-create por `contenido` exacto (viven en el mismo reporte, así
    // que el título no sirve de identificador aquí).
    async function findOrCreateComentarioModeracion(
      contenido: string,
      idUsuarioAutor: number,
    ): Promise<{ comentario: Comentario; creado: boolean }> {
      const existente = await comentarioRepo.findOne({
        where: { idReporte: moderationReport!.idReporte, contenido },
      });
      if (existente) {
        return { comentario: existente, creado: false };
      }
      const nuevo = await comentarioRepo.save(
        comentarioRepo.create({
          idReporte: moderationReport!.idReporte,
          idUsuario: idUsuarioAutor,
          contenido,
          anonimo: false,
        }),
      );
      return { comentario: nuevo, creado: true };
    }

    // 1) 3+ denuncias de motivos distintos, cada una con detalle -> oculto_auto.
    const { comentario: comentarioModeracionA, creado: creadoA } =
      await findOrCreateComentarioModeracion(
        'Comentario de ejemplo con 3 denuncias de motivos distintos para la demo de moderación.',
        usuarios[1].idUsuario,
      );
    if (creadoA) {
      const denunciantesA = usuarios
        .filter((u) => u.idUsuario !== comentarioModeracionA.idUsuario)
        .slice(0, 3);
      const motivosA: MotivoDenuncia[] = [
        'spam',
        'acoso',
        'informacion_personal',
      ];
      for (let k = 0; k < denunciantesA.length; k++) {
        await denunciaRepo.save(
          denunciaRepo.create({
            idComentario: comentarioModeracionA.idComentario,
            idUsuario: denunciantesA[k].idUsuario,
            motivo: motivosA[k % motivosA.length],
            detalle: `Detalle de ejemplo para la denuncia por ${motivosA[k % motivosA.length]} (demo).`,
          }),
        );
        denunciasCreadas++;
      }
      await comentarioRepo.update(
        { idComentario: comentarioModeracionA.idComentario },
        { estado: 'oculto_auto', totalDenuncias: denunciantesA.length },
      );
      comentariosCreados++;
    }

    // 2) Una denuncia, todavía por debajo del umbral -> sigue visible, pendiente.
    const { comentario: comentarioModeracionB, creado: creadoB } =
      await findOrCreateComentarioModeracion(
        'Comentario de ejemplo con una denuncia pendiente, todavía visible (demo de moderación).',
        usuarios[2].idUsuario,
      );
    if (creadoB) {
      const denuncianteB = usuarios.find(
        (u) => u.idUsuario !== comentarioModeracionB.idUsuario,
      );
      if (denuncianteB) {
        await denunciaRepo.save(
          denunciaRepo.create({
            idComentario: comentarioModeracionB.idComentario,
            idUsuario: denuncianteB.idUsuario,
            motivo: 'otro',
            detalle:
              'Detalle de ejemplo para una denuncia todavía pendiente (demo).',
          }),
        );
        denunciasCreadas++;
        await comentarioRepo.update(
          { idComentario: comentarioModeracionB.idComentario },
          { totalDenuncias: 1 },
        );
      }
      comentariosCreados++;
    }

    // 3) Contenido XSS: el panel nunca debe interpretarlo como HTML (4.7).
    const { creado: creadoC } = await findOrCreateComentarioModeracion(
      '<img src=x onerror=alert(1)>',
      usuarios[3].idUsuario,
    );
    if (creadoC) {
      comentariosCreados++;
    }

    // 4) Cadena larga sin espacios: prueba el ajuste de texto del panel.
    const cadenaLarga = Array.from({ length: 300 }, (_, idx) =>
      String.fromCharCode(97 + ((idx * 7) % 26)),
    ).join('');
    const { creado: creadoD } = await findOrCreateComentarioModeracion(
      cadenaLarga,
      usuarios[4].idUsuario,
    );
    if (creadoD) {
      comentariosCreados++;
    }

    // --- Resumen ---
    console.log('--- Usuarios demo ---');
    for (const { etiqueta, creado } of usuariosResultado) {
      console.log(`  [${creado ? 'creado' : 'ya existía'}] ${etiqueta}`);
    }
    console.log(
      `  [${usuarioSuspendidoEstaCorrida ? 'suspendido en esta corrida' : 'ya estaba suspendido'}] ${usuarioASuspender.correo}`,
    );
    console.log(
      `  [${segundoAdminCreado ? 'creado' : 'ya existía'}] ${SEGUNDO_ADMIN_CORREO} (segundo admin, contraseña inutilizable)`,
    );
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
