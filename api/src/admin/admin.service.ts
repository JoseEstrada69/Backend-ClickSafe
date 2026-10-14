import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { MfaService } from '../auth/mfa.service';
import { RequestMeta, SessionService } from '../auth/session.service';
import { PaginatedResponse } from '../common/interfaces/paginated-response.interface';
import { escapeLikePattern } from '../common/utils/escape-like';
import { hashPassword } from '../common/utils/password-hash';
import { isDuplicateKeyError } from '../common/utils/is-duplicate-key-error';
import {
  BitacoraAuditoria,
  CategoriaFraude,
  Comentario,
  DenunciaComentario,
  Evidencia,
  Plataforma,
  Reporte,
  RevisionReporte,
  Usuario,
} from '../database/entities';
import { EvidenceUrlService } from '../evidences/evidence-url.service';
import { NotificationsService } from '../notifications/notifications.service';
import { STORAGE_SERVICE } from '../storage/storage.service.interface';
import type { StorageService } from '../storage/storage.service.interface';
import {
  AdminCategoryResponse,
  AdminPlatformResponse,
  AdminReportDetailResponse,
  AdminReportResponse,
  AdminStatsMonthEntry,
  AdminStatsResponse,
  AdminUserResponse,
  AuditLogEntryResponse,
  FlaggedCommentResponse,
} from './dto/admin-response.dto';
import { AdminReportQueryDto } from './dto/admin-report-query.dto';
import { AdminUserQueryDto } from './dto/admin-user-query.dto';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { CreateAdminDto } from './dto/create-admin.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreatePlatformDto } from './dto/create-platform.dto';
import {
  AccionModeracion,
  ModerateCommentDto,
} from './dto/moderate-comment.dto';
import { ReviewReportDto } from './dto/review-report.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { UpdatePlatformDto } from './dto/update-platform.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';

const MONTHLY_STATS_MONTHS = 12; // sección 1 regla 11: dashboard admin, estadísticas por mes.

@Injectable()
export class AdminService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly sessionService: SessionService,
    private readonly authService: AuthService,
    private readonly mfaService: MfaService,
    private readonly notificationsService: NotificationsService,
    private readonly evidenceUrlService: EvidenceUrlService,
    @Inject(STORAGE_SERVICE)
    private readonly storageService: StorageService,
    @InjectRepository(Reporte)
    private readonly reporteRepo: Repository<Reporte>,
    @InjectRepository(Evidencia)
    private readonly evidenciaRepo: Repository<Evidencia>,
    @InjectRepository(RevisionReporte)
    private readonly revisionRepo: Repository<RevisionReporte>,
    @InjectRepository(Comentario)
    private readonly comentarioRepo: Repository<Comentario>,
    @InjectRepository(DenunciaComentario)
    private readonly denunciaRepo: Repository<DenunciaComentario>,
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
    @InjectRepository(BitacoraAuditoria)
    private readonly bitacoraRepo: Repository<BitacoraAuditoria>,
    @InjectRepository(Plataforma)
    private readonly plataformaRepo: Repository<Plataforma>,
    @InjectRepository(CategoriaFraude)
    private readonly categoriaRepo: Repository<CategoriaFraude>,
  ) {}

  // ---- Reportes ----

  async listReports(
    query: AdminReportQueryDto,
  ): Promise<PaginatedResponse<AdminReportResponse>> {
    const qb = this.reporteRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.usuario', 'autor')
      .leftJoinAndSelect('r.plataforma', 'plataforma')
      .leftJoinAndSelect('r.categoria', 'categoria');

    if (query.estado && query.estado !== 'todos') {
      qb.andWhere('r.estado = :estado', { estado: query.estado });
    }
    qb.orderBy('r.fechaCreacion', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    const [reportes, total] = await qb.getManyAndCount();
    const ids = reportes.map((r) => r.idReporte);
    const evidencias = ids.length
      ? await this.evidenciaRepo.find({ where: { idReporte: In(ids) } })
      : [];
    const evidenciasByReporte = new Map<number, Evidencia[]>();
    for (const evidencia of evidencias) {
      const list = evidenciasByReporte.get(evidencia.idReporte) ?? [];
      list.push(evidencia);
      evidenciasByReporte.set(evidencia.idReporte, list);
    }

    return {
      items: reportes.map((r) => ({
        id: r.idReporte,
        titulo: r.titulo,
        descripcion: r.descripcion,
        urlPublicacion: r.urlPublicacion,
        plataforma: {
          id: r.plataforma.idPlataforma,
          nombre: r.plataforma.nombre,
        },
        plataformaOtra: r.plataformaOtra,
        categoria: { id: r.categoria.idCategoria, nombre: r.categoria.nombre },
        estado: r.estado,
        anonimo: r.anonimo,
        autor: { nombre: r.usuario.nombre, correo: r.usuario.correo },
        totalLikes: r.totalLikes,
        evidencias: (evidenciasByReporte.get(r.idReporte) ?? []).map((e) => ({
          id: e.idEvidencia,
          url: this.evidenceUrlService.buildSignedPath(e.idEvidencia),
        })),
        fechaCreacion: r.fechaCreacion.toISOString(),
        fechaActualizacion: r.fechaActualizacion.toISOString(),
      })),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  /**
   * GET /admin/reports/:id (sección 7): detalle de cualquier reporte, sin
   * filtrar por estado (a diferencia de la cola). `esMio` es informativo
   * nada más — la restricción real de "no revisar lo propio" vive en
   * reviewReport, no aquí.
   */
  async getReportById(
    idReporte: number,
    adminId: number,
  ): Promise<AdminReportDetailResponse> {
    const reporte = await this.reporteRepo.findOne({
      where: { idReporte },
      relations: { usuario: true, plataforma: true, categoria: true },
    });
    if (!reporte) {
      throw new NotFoundException();
    }

    const [evidencias, revision, totalComentarios] = await Promise.all([
      this.evidenciaRepo.find({
        where: { idReporte },
        order: { idEvidencia: 'ASC' },
      }),
      this.revisionRepo.findOne({
        where: { idReporte },
        order: { fechaRevision: 'DESC' },
      }),
      this.comentarioRepo.count({ where: { idReporte, estado: 'visible' } }),
    ]);

    return {
      id: reporte.idReporte,
      titulo: reporte.titulo,
      descripcion: reporte.descripcion,
      urlPublicacion: reporte.urlPublicacion,
      plataforma: {
        id: reporte.plataforma.idPlataforma,
        nombre: reporte.plataforma.nombre,
      },
      plataformaOtra: reporte.plataformaOtra,
      categoria: {
        id: reporte.categoria.idCategoria,
        nombre: reporte.categoria.nombre,
      },
      estado: reporte.estado,
      anonimo: reporte.anonimo,
      autor: { nombre: reporte.usuario.nombre, correo: reporte.usuario.correo },
      totalLikes: reporte.totalLikes,
      evidencias: evidencias.map((e) => ({
        id: e.idEvidencia,
        url: this.evidenceUrlService.buildSignedPath(e.idEvidencia),
      })),
      fechaCreacion: reporte.fechaCreacion.toISOString(),
      fechaActualizacion: reporte.fechaActualizacion.toISOString(),
      revision: revision
        ? {
            decision: revision.decision,
            comentario: revision.comentario,
            fecha: revision.fechaRevision.toISOString(),
          }
        : null,
      esMio: reporte.idUsuario === adminId,
      totalComentarios,
    };
  }

  /** No puede revisar un reporte propio (separación de funciones, sección 1 regla 7) y solo mientras esté pendiente (atómico). */
  async reviewReport(
    idReporte: number,
    adminId: number,
    dto: ReviewReportDto,
  ): Promise<void> {
    const reporte = await this.reporteRepo.findOne({ where: { idReporte } });
    if (!reporte) {
      throw new NotFoundException();
    }
    if (reporte.idUsuario === adminId) {
      throw new ForbiddenException({
        message: 'No puedes revisar tu propio reporte.',
        code: 'OWN_REPORT',
      });
    }

    const result = await this.reporteRepo.update(
      { idReporte, estado: 'pendiente' },
      { estado: dto.decision },
    );
    if (!result.affected) {
      throw new BadRequestException({
        message: 'El reporte ya fue revisado.',
        code: 'REPORT_NOT_EDITABLE',
      });
    }

    await this.revisionRepo.save(
      this.revisionRepo.create({
        idReporte,
        idAdministrador: adminId,
        decision: dto.decision,
        comentario: dto.comentario ?? null,
      }),
    );

    const mensaje =
      dto.decision === 'validado'
        ? 'Tu reporte fue validado.'
        : 'Tu reporte fue rechazado.';
    await this.notificationsService.create(
      reporte.idUsuario,
      idReporte,
      dto.decision === 'validado' ? 'reporte_validado' : 'reporte_rechazado',
      mensaje,
    );

    await this.auditService.log({
      idUsuario: adminId,
      accion: 'reporte_revisado',
      resultado: 'exito',
      recursoTipo: 'Reporte',
      recursoId: idReporte,
      detalle: { decision: dto.decision },
    });
  }

  /** Para quitar imágenes con datos personales, en cualquier estado del reporte (sección 6, punto 8). */
  async deleteEvidence(
    idReporte: number,
    idEvidencia: number,
    adminId: number,
  ): Promise<void> {
    const evidencia = await this.evidenciaRepo.findOne({
      where: { idEvidencia, idReporte },
    });
    if (!evidencia) {
      throw new NotFoundException();
    }

    await this.evidenciaRepo.delete({ idEvidencia });
    await this.storageService
      .delete(evidencia.rutaArchivo)
      .catch(() => undefined);

    await this.auditService.log({
      idUsuario: adminId,
      accion: 'evidencia_eliminada',
      resultado: 'exito',
      recursoTipo: 'Evidencia',
      recursoId: idEvidencia,
      detalle: { idReporte },
    });
  }

  // ---- Comentarios ----

  async listFlaggedComments(): Promise<FlaggedCommentResponse[]> {
    const comentarios = await this.comentarioRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.usuario', 'autor')
      .where("c.estado = 'oculto_auto'")
      .orWhere("c.estado = 'visible' AND c.totalDenuncias > 0")
      .orderBy('c.totalDenuncias', 'DESC')
      .getMany();

    const ids = comentarios.map((c) => c.idComentario);
    const denuncias = ids.length
      ? await this.denunciaRepo.find({
          where: { idComentario: In(ids), resuelta: false },
        })
      : [];
    const motivosByComentario = new Map<number, Set<string>>();
    for (const denuncia of denuncias) {
      const set = motivosByComentario.get(denuncia.idComentario) ?? new Set();
      set.add(denuncia.motivo);
      motivosByComentario.set(denuncia.idComentario, set);
    }

    return comentarios.map((c) => ({
      id: c.idComentario,
      contenido: c.contenido,
      estado: c.estado,
      totalDenuncias: c.totalDenuncias,
      autor: { nombre: c.usuario.nombre, correo: c.usuario.correo },
      reporteId: c.idReporte,
      motivos: Array.from(
        motivosByComentario.get(c.idComentario) ?? [],
      ) as FlaggedCommentResponse['motivos'],
      fechaCreacion: c.fechaCreacion.toISOString(),
    }));
  }

  async moderateComment(
    idComentario: number,
    adminId: number,
    dto: ModerateCommentDto,
  ): Promise<void> {
    const comentario = await this.comentarioRepo.findOne({
      where: { idComentario },
    });
    if (!comentario) {
      throw new NotFoundException();
    }

    const nuevoEstado = dto.accion === 'confirmar' ? 'oculto_admin' : 'visible';

    await this.dataSource.transaction(async (manager) => {
      await manager.update(
        Comentario,
        { idComentario },
        {
          estado: nuevoEstado,
          idModerador: adminId,
          fechaModeracion: new Date(),
          totalDenuncias: 0,
        },
      );
      await manager.update(
        DenunciaComentario,
        { idComentario, resuelta: false },
        { resuelta: true },
      );
    });

    await this.auditService.log({
      idUsuario: adminId,
      accion: 'comentario_moderado',
      resultado: 'exito',
      recursoTipo: 'Comentario',
      recursoId: idComentario,
      detalle: { accion: dto.accion satisfies AccionModeracion },
    });

    if (dto.accion === 'confirmar') {
      await this.notificationsService.create(
        comentario.idUsuario,
        comentario.idReporte,
        'comentario_ocultado',
        'Un comentario tuyo fue ocultado por infringir las reglas de la comunidad.',
      );
    }
  }

  // ---- Usuarios ----

  async listUsers(
    query: AdminUserQueryDto,
  ): Promise<PaginatedResponse<AdminUserResponse>> {
    const qb = this.usuarioRepo.createQueryBuilder('u');
    if (query.q) {
      const pattern = `%${escapeLikePattern(query.q)}%`;
      qb.andWhere('(u.nombre LIKE :q OR u.correo LIKE :q)', { q: pattern });
    }
    qb.orderBy('u.fechaRegistro', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    const [usuarios, total] = await qb.getManyAndCount();
    return {
      items: usuarios.map((u) => ({
        id: u.idUsuario,
        nombre: u.nombre,
        correo: u.correo,
        rol: u.rol,
        activo: u.activo,
        correoVerificado: u.correoVerificado,
        fechaRegistro: u.fechaRegistro.toISOString(),
      })),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  async updateUserStatus(
    idUsuario: number,
    adminId: number,
    dto: UpdateUserStatusDto,
  ): Promise<void> {
    if (idUsuario === adminId) {
      throw new BadRequestException('No puedes cambiar tu propio estado.');
    }
    const usuario = await this.usuarioRepo.findOne({ where: { idUsuario } });
    if (!usuario) {
      throw new NotFoundException();
    }

    // Solo importa si esta acción REALMENTE apagaría al último admin activo:
    // si ya estaba inactivo, repetir la desactivación es un no-op y no debe
    // bloquearse aunque el admin que llama sea, él mismo, el único activo.
    if (!dto.activo && usuario.rol === 'admin' && usuario.activo) {
      const activeAdmins = await this.usuarioRepo.count({
        where: { rol: 'admin', activo: true },
      });
      if (activeAdmins <= 1) {
        throw new BadRequestException(
          'No puedes desactivar al último admin activo.',
        );
      }
    }

    await this.usuarioRepo.update({ idUsuario }, { activo: dto.activo });
    if (!dto.activo) {
      await this.sessionService.revokeAllForUser(idUsuario);
    }

    await this.auditService.log({
      idUsuario: adminId,
      accion: dto.activo ? 'usuario_reactivado' : 'usuario_suspendido',
      resultado: 'exito',
      recursoTipo: 'Usuario',
      recursoId: idUsuario,
    });
  }

  /**
   * POST /admin/admins (sección 7/8): requiere reautenticación con el TOTP
   * del propio admin que llama (separación de funciones, no el código de
   * nadie más). La cuenta nueva nace con una contraseña inutilizable que
   * nadie conserva; el nuevo admin recibe un código de recuperación (5.7)
   * para definir la suya, igual que el seed del primer admin (sección 8)
   * pero disparado desde la API en vez de un script.
   */
  async createAdmin(
    dto: CreateAdminDto,
    callerId: number,
    meta: RequestMeta = {},
  ): Promise<AdminUserResponse> {
    const caller = await this.usuarioRepo.findOne({
      where: { idUsuario: callerId },
    });
    if (!caller) {
      throw new UnauthorizedException();
    }
    await this.mfaService.reauthenticateAdmin(caller, dto.totp, meta);

    const correo = dto.correo.trim().toLowerCase();
    const existing = await this.usuarioRepo.findOne({ where: { correo } });
    if (existing) {
      throw new ConflictException('El correo ya está en uso.');
    }

    const passwordHash = await hashPassword(randomBytes(32).toString('hex'));
    let nuevo: Usuario;
    try {
      nuevo = await this.usuarioRepo.save(
        this.usuarioRepo.create({
          nombre: dto.nombre,
          correo,
          passwordHash,
          rol: 'admin',
          correoVerificado: true,
          activo: true,
        }),
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('El correo ya está en uso.');
      }
      throw error;
    }

    await this.authService.sendPasswordRecoveryCode(nuevo);
    await this.auditService.log({
      idUsuario: callerId,
      accion: 'admin_creado',
      resultado: 'exito',
      recursoTipo: 'Usuario',
      recursoId: nuevo.idUsuario,
      detalle: { via: 'admin' },
    });

    return {
      id: nuevo.idUsuario,
      nombre: nuevo.nombre,
      correo: nuevo.correo,
      rol: nuevo.rol,
      activo: nuevo.activo,
      correoVerificado: nuevo.correoVerificado,
      fechaRegistro: nuevo.fechaRegistro.toISOString(),
    };
  }

  // ---- Catálogos: plataformas ----

  /** Incluye inactivas (a diferencia de GET /platforms): el admin necesita verlas para poder reactivarlas. */
  async listPlatforms(): Promise<AdminPlatformResponse[]> {
    const rows = await this.plataformaRepo.find({ order: { nombre: 'ASC' } });
    return rows.map((p) => this.toPlatformResponse(p));
  }

  /** `esOtra` nunca se acepta aquí (CreatePlatformDto no lo declara): solo existe la "Otra" del .sql. */
  async createPlatform(
    dto: CreatePlatformDto,
    adminId: number,
  ): Promise<AdminPlatformResponse> {
    let saved: Plataforma;
    try {
      saved = await this.plataformaRepo.save(
        this.plataformaRepo.create({
          nombre: dto.nombre,
          esOtra: false,
          activa: true,
        }),
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('Ya existe una plataforma con ese nombre.');
      }
      throw error;
    }

    await this.auditService.log({
      idUsuario: adminId,
      accion: 'catalogo_modificado',
      resultado: 'exito',
      recursoTipo: 'Plataforma',
      recursoId: saved.idPlataforma,
      detalle: { accion: 'crear' },
    });

    return this.toPlatformResponse(saved);
  }

  /** Nunca se puede desactivar la plataforma "Otra" (sección 1 regla 10, CLAUDE.md). */
  async updatePlatform(
    idPlataforma: number,
    dto: UpdatePlatformDto,
    adminId: number,
  ): Promise<AdminPlatformResponse> {
    const plataforma = await this.plataformaRepo.findOne({
      where: { idPlataforma },
    });
    if (!plataforma) {
      throw new NotFoundException();
    }
    if (plataforma.esOtra && dto.activa === false) {
      throw new BadRequestException(
        'No puedes desactivar la plataforma "Otra".',
      );
    }

    const patch: Partial<Plataforma> = {};
    if (dto.nombre !== undefined) patch.nombre = dto.nombre;
    if (dto.activa !== undefined) patch.activa = dto.activa;

    try {
      await this.plataformaRepo.update({ idPlataforma }, patch);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('Ya existe una plataforma con ese nombre.');
      }
      throw error;
    }

    await this.auditService.log({
      idUsuario: adminId,
      accion: 'catalogo_modificado',
      resultado: 'exito',
      recursoTipo: 'Plataforma',
      recursoId: idPlataforma,
      detalle: { accion: 'editar' },
    });

    const updated = await this.plataformaRepo.findOne({
      where: { idPlataforma },
    });
    return this.toPlatformResponse(updated as Plataforma);
  }

  // ---- Catálogos: categorías ----

  async listCategories(): Promise<AdminCategoryResponse[]> {
    const rows = await this.categoriaRepo.find({ order: { nombre: 'ASC' } });
    return rows.map((c) => this.toCategoryResponse(c));
  }

  async createCategory(
    dto: CreateCategoryDto,
    adminId: number,
  ): Promise<AdminCategoryResponse> {
    let saved: CategoriaFraude;
    try {
      saved = await this.categoriaRepo.save(
        this.categoriaRepo.create({
          nombre: dto.nombre,
          descripcion: dto.descripcion ?? null,
          activa: true,
        }),
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('Ya existe una categoría con ese nombre.');
      }
      throw error;
    }

    await this.auditService.log({
      idUsuario: adminId,
      accion: 'catalogo_modificado',
      resultado: 'exito',
      recursoTipo: 'Categoria_fraude',
      recursoId: saved.idCategoria,
      detalle: { accion: 'crear' },
    });

    return this.toCategoryResponse(saved);
  }

  async updateCategory(
    idCategoria: number,
    dto: UpdateCategoryDto,
    adminId: number,
  ): Promise<AdminCategoryResponse> {
    const categoria = await this.categoriaRepo.findOne({
      where: { idCategoria },
    });
    if (!categoria) {
      throw new NotFoundException();
    }

    const patch: Partial<CategoriaFraude> = {};
    if (dto.nombre !== undefined) patch.nombre = dto.nombre;
    if (dto.descripcion !== undefined) patch.descripcion = dto.descripcion;
    if (dto.activa !== undefined) patch.activa = dto.activa;

    try {
      await this.categoriaRepo.update({ idCategoria }, patch);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('Ya existe una categoría con ese nombre.');
      }
      throw error;
    }

    await this.auditService.log({
      idUsuario: adminId,
      accion: 'catalogo_modificado',
      resultado: 'exito',
      recursoTipo: 'Categoria_fraude',
      recursoId: idCategoria,
      detalle: { accion: 'editar' },
    });

    const updated = await this.categoriaRepo.findOne({
      where: { idCategoria },
    });
    return this.toCategoryResponse(updated as CategoriaFraude);
  }

  private toPlatformResponse(p: Plataforma): AdminPlatformResponse {
    return {
      id: p.idPlataforma,
      nombre: p.nombre,
      esOtra: p.esOtra,
      activa: p.activa,
    };
  }

  private toCategoryResponse(c: CategoriaFraude): AdminCategoryResponse {
    return {
      id: c.idCategoria,
      nombre: c.nombre,
      descripcion: c.descripcion,
      activa: c.activa,
    };
  }

  // ---- Estadísticas ----

  async getStats(): Promise<AdminStatsResponse> {
    const [porPlataforma, porCategoria, porEstado, porMes] = await Promise.all([
      this.reporteRepo
        .createQueryBuilder('r')
        .innerJoin('r.plataforma', 'p')
        .select(
          "CASE WHEN p.es_otra = TRUE THEN 'Otra' ELSE p.nombre END",
          'plataforma',
        )
        .addSelect('COUNT(*)', 'total')
        .groupBy('plataforma')
        .orderBy('total', 'DESC')
        .getRawMany<{ plataforma: string; total: string }>(),
      this.reporteRepo
        .createQueryBuilder('r')
        .innerJoin('r.categoria', 'c')
        .select('c.nombre', 'categoria')
        .addSelect('COUNT(*)', 'total')
        .groupBy('c.nombre')
        .orderBy('total', 'DESC')
        .getRawMany<{ categoria: string; total: string }>(),
      this.reporteRepo
        .createQueryBuilder('r')
        .select('r.estado', 'estado')
        .addSelect('COUNT(*)', 'total')
        .groupBy('r.estado')
        .getRawMany<{
          estado: AdminStatsResponse['porEstado'][number]['estado'];
          total: string;
        }>(),
      this.getMonthlyStats(),
    ]);

    return {
      porPlataforma: porPlataforma.map((row) => ({
        plataforma: row.plataforma,
        total: Number(row.total),
      })),
      porCategoria: porCategoria.map((row) => ({
        categoria: row.categoria,
        total: Number(row.total),
      })),
      porEstado: porEstado.map((row) => ({
        estado: row.estado,
        total: Number(row.total),
      })),
      porMes,
    };
  }

  /**
   * Últimos 12 meses en UTC (sección 1 regla 11), incluidos los que no
   * tienen reportes (total: 0) para que el dashboard pueda graficar una
   * serie continua. La sesión de MySQL ya corre en UTC
   * (MysqlSessionTimezoneInitializer), así que DATE_FORMAT agrupa en UTC
   * sin necesidad de convertir nada a mano.
   */
  private async getMonthlyStats(): Promise<AdminStatsMonthEntry[]> {
    const startOfCurrentMonthUtc = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
    );
    const desde = new Date(startOfCurrentMonthUtc);
    desde.setUTCMonth(desde.getUTCMonth() - (MONTHLY_STATS_MONTHS - 1));

    const rows = await this.reporteRepo
      .createQueryBuilder('r')
      .select("DATE_FORMAT(r.fecha_creacion, '%Y-%m')", 'mes')
      .addSelect('COUNT(*)', 'total')
      .where('r.fecha_creacion >= :desde', { desde })
      .groupBy('mes')
      .getRawMany<{ mes: string; total: string }>();

    const totalByMonth = new Map(
      rows.map((row) => [row.mes, Number(row.total)]),
    );

    const series: AdminStatsMonthEntry[] = [];
    for (let i = MONTHLY_STATS_MONTHS - 1; i >= 0; i--) {
      const mesDate = new Date(startOfCurrentMonthUtc);
      mesDate.setUTCMonth(mesDate.getUTCMonth() - i);
      const mes = `${mesDate.getUTCFullYear()}-${String(mesDate.getUTCMonth() + 1).padStart(2, '0')}`;
      series.push({ mes, total: totalByMonth.get(mes) ?? 0 });
    }
    return series;
  }

  // ---- Bitácora ----

  async getAuditLog(
    query: AuditLogQueryDto,
  ): Promise<PaginatedResponse<AuditLogEntryResponse>> {
    const qb = this.bitacoraRepo
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.usuario', 'usuario');
    if (query.accion) {
      qb.andWhere('b.accion = :accion', { accion: query.accion });
    }
    if (query.usuario) {
      qb.andWhere('b.idUsuario = :idUsuario', { idUsuario: query.usuario });
    }
    if (query.desde) {
      qb.andWhere('b.fecha >= :desde', { desde: query.desde });
    }
    if (query.hasta) {
      qb.andWhere('b.fecha <= :hasta', { hasta: query.hasta });
    }
    qb.orderBy('b.fecha', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    const [rows, total] = await qb.getManyAndCount();
    return {
      items: rows.map((row) => ({
        id: row.idEvento,
        fecha: row.fecha.toISOString(),
        idUsuario: row.idUsuario,
        usuario: row.usuario
          ? { nombre: row.usuario.nombre, correo: row.usuario.correo }
          : null,
        accion: row.accion,
        resultado: row.resultado,
        recursoTipo: row.recursoTipo,
        recursoId: row.recursoId,
        ip: row.ip,
        userAgent: row.userAgent,
        detalle: row.detalle,
      })),
      page: query.page,
      limit: query.limit,
      total,
    };
  }
}
