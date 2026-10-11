import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { PaginatedResponse } from '../common/interfaces/paginated-response.interface';
import { escapeLikePattern } from '../common/utils/escape-like';
import {
  BitacoraAuditoria,
  Comentario,
  DenunciaComentario,
  Evidencia,
  Reporte,
  RevisionReporte,
  Usuario,
} from '../database/entities';
import { EvidenceUrlService } from '../evidences/evidence-url.service';
import { NotificationsService } from '../notifications/notifications.service';
import { STORAGE_SERVICE } from '../storage/storage.service.interface';
import type { StorageService } from '../storage/storage.service.interface';
import {
  AdminReportResponse,
  AdminStatsResponse,
  AdminUserResponse,
  AuditLogEntryResponse,
  FlaggedCommentResponse,
} from './admin-response.interface';
import { AdminReportQueryDto } from './dto/admin-report-query.dto';
import { AdminUserQueryDto } from './dto/admin-user-query.dto';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import {
  AccionModeracion,
  ModerateCommentDto,
} from './dto/moderate-comment.dto';
import { ReviewReportDto } from './dto/review-report.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly sessionService: SessionService,
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

    if (query.estado) {
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

  // ---- Estadísticas ----

  async getStats(): Promise<AdminStatsResponse> {
    const [porPlataforma, porCategoria, porEstado] = await Promise.all([
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
    };
  }

  // ---- Bitácora ----

  async getAuditLog(
    query: AuditLogQueryDto,
  ): Promise<PaginatedResponse<AuditLogEntryResponse>> {
    const qb = this.bitacoraRepo.createQueryBuilder('b');
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
