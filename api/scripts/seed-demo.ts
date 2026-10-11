import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/common/utils/password-hash';
import {
  CategoriaFraude,
  Comentario,
  DenunciaComentario,
  LikeReporte,
  Notificacion,
  Plataforma,
  Reporte,
  RevisionReporte,
  Usuario,
} from '../src/database/entities';

const DEMO_EMAIL_SUFFIX = '@demo.clicksafe.local';
const DEMO_PASSWORD = 'Demo1234!Seguro';

/**
 * npm run seed:demo. Llena clicksafe_db con datos de ejemplo realistas
 * para la demo/pruebas de seguridad, SOLO vía repositorios (sin pasar por
 * sharp/evidencias: el alcance pedido es reportes, comentarios, likes,
 * denuncias y notificaciones, no imágenes). Se niega a correr si ya
 * existen usuarios demo (marcados por el dominio de correo
 * @demo.clicksafe.local), para no duplicar datos en cada corrida.
 */
async function run(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
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

    const existingDemo = await usuarioRepo
      .createQueryBuilder('u')
      .where('u.correo LIKE :pattern', { pattern: `%${DEMO_EMAIL_SUFFIX}` })
      .getOne();
    if (existingDemo) {
      console.log(
        'Ya existen datos de demo (encontrado al menos un usuario @demo.clicksafe.local). No se creó nada.',
      );
      return;
    }

    const passwordHash = await hashPassword(DEMO_PASSWORD);

    // --- Usuarios (5 normales + 1 admin para poder revisar reportes) ---
    const nombresUsuarios = [
      'Ana García',
      'Luis Fernández',
      'María Torres',
      'Carlos Ruiz',
      'Sofía Hernández',
    ];
    const usuarios = await usuarioRepo.save(
      nombresUsuarios.map((nombre, i) =>
        usuarioRepo.create({
          nombre,
          correo: `demo.usuario${i + 1}${DEMO_EMAIL_SUFFIX}`,
          correoVerificado: true,
          passwordHash,
          rol: 'usuario',
          activo: true,
        }),
      ),
    );

    const admin = await usuarioRepo.save(
      usuarioRepo.create({
        nombre: 'Admin Demo',
        correo: `demo.admin${DEMO_EMAIL_SUFFIX}`,
        correoVerificado: true,
        passwordHash,
        rol: 'admin',
        activo: true,
      }),
    );

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

    // --- Reportes: 20 en total, repartidos en los 3 estados ---
    const TOTAL_REPORTES = 20;
    const titulos = [
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
    ];

    interface ReporteDemo {
      reporte: Reporte;
      autorId: number;
    }
    const reportesCreados: ReporteDemo[] = [];

    for (let i = 0; i < TOTAL_REPORTES; i++) {
      const autor = usuarios[i % usuarios.length];
      const esOtraPlataforma = i % 6 === 0; // ~3 de 20 usan "Otra"
      const plataforma = esOtraPlataforma
        ? otra
        : normales[i % normales.length];
      const categoria = categorias[i % categorias.length];
      const anonimo = i % 4 === 0; // 5 de 20 anónimos
      const estado = i < 10 ? 'pendiente' : i < 17 ? 'validado' : 'rechazado';

      const reporte = await reporteRepo.save(
        reporteRepo.create({
          idUsuario: autor.idUsuario,
          idPlataforma: plataforma.idPlataforma,
          plataformaOtra: esOtraPlataforma ? 'Tienda de ejemplo' : null,
          idCategoria: categoria.idCategoria,
          titulo: titulos[i % titulos.length],
          descripcion:
            'Descripción de ejemplo generada por npm run seed:demo. ' +
            'Este reporte no corresponde a un caso real, es solo para pruebas.',
          urlPublicacion: `https://tienda-ejemplo.demo/producto-${i + 1}`,
          anonimo,
          estado,
        }),
      );
      reportesCreados.push({ reporte, autorId: autor.idUsuario });

      if (estado !== 'pendiente') {
        await revisionRepo.save(
          revisionRepo.create({
            idReporte: reporte.idReporte,
            idAdministrador: admin.idUsuario,
            decision: estado,
            comentario:
              estado === 'validado'
                ? 'Caso verificado, evidencia suficiente.'
                : 'No se pudo verificar la denuncia.',
          }),
        );
        await notificacionRepo.save(
          notificacionRepo.create({
            idUsuario: autor.idUsuario,
            idReporte: reporte.idReporte,
            tipo:
              estado === 'validado' ? 'reporte_validado' : 'reporte_rechazado',
            mensaje:
              estado === 'validado'
                ? 'Tu reporte fue validado.'
                : 'Tu reporte fue rechazado.',
          }),
        );
      }
    }

    // --- Likes: cada usuario le da like a ~3 reportes ajenos ---
    for (const usuario of usuarios) {
      const candidatos = reportesCreados.filter(
        (r) => r.autorId !== usuario.idUsuario,
      );
      const elegidos = candidatos.slice(0, 3);
      for (const { reporte } of elegidos) {
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
      }
    }

    // --- Comentarios: 2-3 por cada uno de los primeros 10 reportes ---
    const comentariosCreados: Comentario[] = [];
    const textosComentario = [
      'A mí me pasó algo parecido con la misma tienda.',
      '¿Alguien más tuvo este problema?',
      'Gracias por reportarlo, me salvaste de comprar ahí.',
      'Yo sí pude recuperar mi dinero contactando al banco.',
      'Esto debería estar prohibido, qué mal.',
    ];
    for (let i = 0; i < 10; i++) {
      const { reporte, autorId } = reportesCreados[i];
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
        comentariosCreados.push(comentario);
        if (comentador.idUsuario !== autorId) {
          await notificacionRepo.save(
            notificacionRepo.create({
              idUsuario: autorId,
              idReporte: reporte.idReporte,
              tipo: 'nuevo_comentario',
              mensaje: 'Tu reporte recibió un nuevo comentario.',
            }),
          );
        }
      }
    }

    // --- Denuncias: un comentario llega al umbral (oculto_auto), otro queda con 1 denuncia pendiente ---
    const [comentarioAOcultar, comentarioConUnaDenuncia] = comentariosCreados;
    const denunciantes = usuarios.filter(
      (u) => u.idUsuario !== comentarioAOcultar.idUsuario,
    );
    for (const denunciante of denunciantes.slice(0, 3)) {
      await denunciaRepo.save(
        denunciaRepo.create({
          idComentario: comentarioAOcultar.idComentario,
          idUsuario: denunciante.idUsuario,
          motivo: 'spam',
        }),
      );
    }
    await comentarioRepo.update(
      { idComentario: comentarioAOcultar.idComentario },
      { estado: 'oculto_auto', totalDenuncias: 3 },
    );

    const primerDenunciante = usuarios.find(
      (u) => u.idUsuario !== comentarioConUnaDenuncia.idUsuario,
    );
    if (primerDenunciante) {
      await denunciaRepo.save(
        denunciaRepo.create({
          idComentario: comentarioConUnaDenuncia.idComentario,
          idUsuario: primerDenunciante.idUsuario,
          motivo: 'lenguaje_ofensivo',
          detalle: 'Comentario de ejemplo marcado para la demo.',
        }),
      );
      await comentarioRepo.update(
        { idComentario: comentarioConUnaDenuncia.idComentario },
        { totalDenuncias: 1 },
      );
    }

    console.log('Datos de demo creados correctamente:');
    console.log(
      `  Usuarios normales: ${usuarios.length} (contraseña: ${DEMO_PASSWORD})`,
    );
    console.log(
      `  Admin demo: ${admin.correo} (contraseña: ${DEMO_PASSWORD}, requiere configurar 2FA en el primer login)`,
    );
    console.log(
      `  Reportes: ${TOTAL_REPORTES} (10 pendientes, 7 validados, 3 rechazados)`,
    );
    console.log(
      `  Comentarios: ${comentariosCreados.length} (uno oculto automáticamente por 3 denuncias)`,
    );
  } finally {
    await app.close();
  }
}

void run();
