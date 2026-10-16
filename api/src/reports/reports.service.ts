import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { escapeLikePattern } from '../common/utils/escape-like';
import { isDuplicateKeyError } from '../common/utils/is-duplicate-key-error';
import { PaginatedResponse } from '../common/interfaces/paginated-response.interface';
import {
  CategoriaFraude,
  Comentario,
  Evidencia,
  LikeReporte,
  Plataforma,
  Reporte,
  RevisionReporte,
} from '../database/entities';
import { EvidenceUrlService } from '../evidences/evidence-url.service';
import {
  ImageProcessingService,
  ProcessedImage,
} from '../evidences/image-processing.service';
import { STORAGE_SERVICE } from '../storage/storage.service.interface';
import type { StorageService } from '../storage/storage.service.interface';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportQueryDto } from './dto/report-query.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { LikeResponse, ReportResponse } from './dto/report-response.dto';

const MAX_EVIDENCES = 5;

interface UploadedFile {
  buffer: Buffer;
}

/**
 * `@UploadedFiles()` (multer) no pasa por el ValidationPipe global (no es un
 * DTO de class-validator): el tipo que declara el controlador
 * (`{ buffer: Buffer }[] | undefined`) es solo una promesa de TypeScript en
 * tiempo de compilación, no algo que el runtime verifique. Hallazgo de
 * CodeQL ("Type confusion through parameter tampering"): si `files` llegara
 * como un string en vez de un arreglo, `files.length` cuenta caracteres
 * (JS permite `.length` en strings) y `files.length > MAX_EVIDENCES` se
 * evalúa igual, sin lanzar — evadiendo el límite de evidencias. Se valida
 * aquí, antes de cualquier `.length`/`.map()`, que de verdad sea un arreglo
 * de objetos con un `buffer` real.
 */
function assertValidUploadedFiles(value: unknown): UploadedFile[] {
  if (
    !Array.isArray(value) ||
    !value.every(
      (file): file is UploadedFile =>
        typeof file === 'object' &&
        file !== null &&
        Buffer.isBuffer((file as { buffer?: unknown }).buffer),
    )
  ) {
    throw new BadRequestException(
      'Las evidencias no tienen el formato esperado.',
    );
  }
  return value;
}

/** Datos ya resueltos para armar un ReportResponse sin volver a consultar la BD por cada fila. */
interface ReportAssemblyContext {
  likedIds: Set<number>;
  evidenciasByReporte: Map<number, Evidencia[]>;
  revisionByReporte: Map<number, RevisionReporte>;
  commentCountByReporte: Map<number, number>;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Reporte)
    private readonly reporteRepo: Repository<Reporte>,
    @InjectRepository(Plataforma)
    private readonly plataformaRepo: Repository<Plataforma>,
    @InjectRepository(CategoriaFraude)
    private readonly categoriaRepo: Repository<CategoriaFraude>,
    @InjectRepository(Evidencia)
    private readonly evidenciaRepo: Repository<Evidencia>,
    @InjectRepository(LikeReporte)
    private readonly likeRepo: Repository<LikeReporte>,
    @InjectRepository(RevisionReporte)
    private readonly revisionRepo: Repository<RevisionReporte>,
    private readonly evidenceUrlService: EvidenceUrlService,
    private readonly imageProcessing: ImageProcessingService,
    @Inject(STORAGE_SERVICE)
    private readonly storageService: StorageService,
  ) {}

  async getFeed(
    query: ReportQueryDto,
    userId: number,
  ): Promise<PaginatedResponse<ReportResponse>> {
    const qb = this.reporteRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.usuario', 'autor')
      .leftJoinAndSelect('r.plataforma', 'plataforma')
      .leftJoinAndSelect('r.categoria', 'categoria');

    if (query.estado) {
      qb.andWhere('r.estado = :estado', { estado: query.estado });
    }
    if (query.plataforma) {
      qb.andWhere('r.idPlataforma = :plataformaId', {
        plataformaId: query.plataforma,
      });
    }
    if (query.categoria) {
      qb.andWhere('r.idCategoria = :categoriaId', {
        categoriaId: query.categoria,
      });
    }
    if (query.q) {
      const pattern = `%${escapeLikePattern(query.q)}%`;
      qb.andWhere(
        '(r.titulo LIKE :q OR r.descripcion LIKE :q OR r.urlPublicacion LIKE :q)',
        { q: pattern },
      );
    }

    if (query.orden === 'populares') {
      qb.orderBy('r.totalLikes', 'DESC').addOrderBy('r.fechaCreacion', 'DESC');
    } else {
      qb.orderBy('r.fechaCreacion', 'DESC');
    }

    qb.skip((query.page - 1) * query.limit).take(query.limit);

    const [reportes, total] = await qb.getManyAndCount();
    const context = await this.buildAssemblyContext(reportes, userId);
    const items = reportes.map((r) => this.toResponse(r, userId, context));

    return { items, page: query.page, limit: query.limit, total };
  }

  async getById(idReporte: number, userId: number): Promise<ReportResponse> {
    const reporte = await this.reporteRepo.findOne({
      where: { idReporte },
      relations: { usuario: true, plataforma: true, categoria: true },
    });
    if (!reporte) {
      throw new NotFoundException();
    }
    const context = await this.buildAssemblyContext([reporte], userId);
    return this.toResponse(reporte, userId, context);
  }

  /** GET /me/reports (sección 7): reportes propios, paginados, incluye los anónimos propios (autor sigue null; esMio distingue). */
  async getMyReports(
    userId: number,
    query: PaginationQueryDto,
  ): Promise<PaginatedResponse<ReportResponse>> {
    const qb = this.reporteRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.usuario', 'autor')
      .leftJoinAndSelect('r.plataforma', 'plataforma')
      .leftJoinAndSelect('r.categoria', 'categoria')
      .where('r.idUsuario = :userId', { userId })
      .orderBy('r.fechaCreacion', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    const [reportes, total] = await qb.getManyAndCount();
    const context = await this.buildAssemblyContext(reportes, userId);
    const items = reportes.map((r) => this.toResponse(r, userId, context));

    return { items, page: query.page, limit: query.limit, total };
  }

  async createReport(
    dto: CreateReportDto,
    filesInput: unknown,
    userId: number,
  ): Promise<ReportResponse> {
    const files = assertValidUploadedFiles(filesInput);
    const plataforma = await this.plataformaRepo.findOne({
      where: { idPlataforma: dto.plataformaId },
    });
    if (!plataforma || !plataforma.activa) {
      throw new BadRequestException({
        message: 'La plataforma no existe o no está disponible.',
        code: 'CATALOG_INACTIVE',
      });
    }
    const categoria = await this.categoriaRepo.findOne({
      where: { idCategoria: dto.categoriaId },
    });
    if (!categoria || !categoria.activa) {
      throw new BadRequestException({
        message: 'La categoría no existe o no está disponible.',
        code: 'CATALOG_INACTIVE',
      });
    }

    if (plataforma.esOtra && !dto.plataformaOtra) {
      throw new BadRequestException({
        message: 'Escribe el nombre de la plataforma en plataformaOtra.',
        code: 'PLATFORM_OTHER_REQUIRED',
      });
    }
    if (!plataforma.esOtra && dto.plataformaOtra) {
      throw new BadRequestException(
        'plataformaOtra solo se puede usar con la plataforma "Otra".',
      );
    }

    if (files.length > MAX_EVIDENCES) {
      throw new BadRequestException({
        message: `Máximo ${MAX_EVIDENCES} evidencias por reporte.`,
        code: 'EVIDENCE_LIMIT',
      });
    }

    const processed: ProcessedImage[] = await Promise.all(
      files.map((file) => this.imageProcessing.process(file.buffer)),
    );

    const savedPaths: string[] = [];
    try {
      for (const image of processed) {
        const fileName = this.imageProcessing.generateFileName();
        const relativePath = this.imageProcessing.buildRelativePath(fileName);
        await this.storageService.save(relativePath, image.buffer);
        savedPaths.push(relativePath);
      }

      const reporte = await this.dataSource.transaction(async (manager) => {
        const nuevo = await manager.save(
          Reporte,
          manager.create(Reporte, {
            idUsuario: userId,
            idPlataforma: dto.plataformaId,
            plataformaOtra: plataforma.esOtra
              ? (dto.plataformaOtra as string)
              : null,
            idCategoria: dto.categoriaId,
            titulo: dto.titulo,
            descripcion: dto.descripcion,
            urlPublicacion: dto.urlPublicacion,
            anonimo: dto.anonimo,
          }),
        );

        for (let i = 0; i < processed.length; i++) {
          const relativePath = savedPaths[i];
          await manager.save(
            Evidencia,
            manager.create(Evidencia, {
              idReporte: nuevo.idReporte,
              nombreArchivo: relativePath.split('/').pop() as string,
              rutaArchivo: relativePath,
              tipoArchivo: this.imageProcessing.tipoArchivo,
              tamanoBytes: processed[i].sizeBytes,
              hashSha256: processed[i].sha256,
            }),
          );
        }

        return nuevo;
      });

      return this.getById(reporte.idReporte, userId);
    } catch (error) {
      await Promise.all(
        savedPaths.map((path) =>
          this.storageService.delete(path).catch(() => undefined),
        ),
      );
      throw error;
    }
  }

  /**
   * POST /reports/:id/evidences: agrega evidencias a un reporte propio ya
   * creado, solo mientras esté pendiente. El bloqueo pesimista sobre la fila
   * del reporte (4.3) evita que, entre contar las evidencias actuales e
   * insertar las nuevas, un admin lo revise a la mitad y el reporte termine
   * con evidencias añadidas después de validado/rechazado.
   */
  async addEvidences(
    idReporte: number,
    userId: number,
    filesInput: unknown,
  ): Promise<ReportResponse> {
    const files = assertValidUploadedFiles(filesInput);
    if (files.length === 0) {
      throw new BadRequestException('Agrega al menos una imagen.');
    }

    const processed: ProcessedImage[] = await Promise.all(
      files.map((file) => this.imageProcessing.process(file.buffer)),
    );

    const savedPaths: string[] = [];
    try {
      for (const image of processed) {
        const fileName = this.imageProcessing.generateFileName();
        const relativePath = this.imageProcessing.buildRelativePath(fileName);
        await this.storageService.save(relativePath, image.buffer);
        savedPaths.push(relativePath);
      }

      await this.dataSource.transaction(async (manager) => {
        const reporte = await manager.findOne(Reporte, {
          where: { idReporte, idUsuario: userId, estado: 'pendiente' },
          lock: { mode: 'pessimistic_write' },
        });
        if (!reporte) {
          await this.assertEditable(idReporte, userId);
        }

        const currentCount = await manager.count(Evidencia, {
          where: { idReporte },
        });
        if (currentCount + processed.length > MAX_EVIDENCES) {
          throw new BadRequestException({
            message: `Máximo ${MAX_EVIDENCES} evidencias por reporte.`,
            code: 'EVIDENCE_LIMIT',
          });
        }

        for (let i = 0; i < processed.length; i++) {
          const relativePath = savedPaths[i];
          await manager.save(
            Evidencia,
            manager.create(Evidencia, {
              idReporte,
              nombreArchivo: relativePath.split('/').pop() as string,
              rutaArchivo: relativePath,
              tipoArchivo: this.imageProcessing.tipoArchivo,
              tamanoBytes: processed[i].sizeBytes,
              hashSha256: processed[i].sha256,
            }),
          );
        }
      });

      return this.getById(idReporte, userId);
    } catch (error) {
      await Promise.all(
        savedPaths.map((path) =>
          this.storageService.delete(path).catch(() => undefined),
        ),
      );
      throw error;
    }
  }

  /** DELETE /reports/:id/evidences/:evidenceId: solo el autor, y solo mientras el reporte esté pendiente (4.3). */
  async deleteEvidenceAsOwner(
    idReporte: number,
    idEvidencia: number,
    userId: number,
  ): Promise<void> {
    let rutaArchivo: string | undefined;

    await this.dataSource.transaction(async (manager) => {
      const reporte = await manager.findOne(Reporte, {
        where: { idReporte, idUsuario: userId, estado: 'pendiente' },
        lock: { mode: 'pessimistic_write' },
      });
      if (!reporte) {
        await this.assertEditable(idReporte, userId);
      }

      const evidencia = await manager.findOne(Evidencia, {
        where: { idEvidencia, idReporte },
      });
      if (!evidencia) {
        throw new NotFoundException();
      }

      await manager.delete(Evidencia, { idEvidencia });
      rutaArchivo = evidencia.rutaArchivo;
    });

    if (rutaArchivo) {
      await this.storageService.delete(rutaArchivo).catch(() => undefined);
    }
  }

  /**
   * UPDATE atómico, condicionado a autor + pendiente en la misma consulta
   * (4.3): previene la carrera en la que el admin valida justo mientras el
   * autor edita. Si no afectó filas, una lectura aparte (ya sin filtrar por
   * estado) decide el error correcto sin reabrir esa ventana de carrera.
   */
  async updateReport(
    idReporte: number,
    userId: number,
    dto: UpdateReportDto,
  ): Promise<ReportResponse> {
    const patch: Partial<Reporte> = {};
    if (dto.titulo !== undefined) patch.titulo = dto.titulo;
    if (dto.descripcion !== undefined) patch.descripcion = dto.descripcion;
    if (dto.urlPublicacion !== undefined) {
      patch.urlPublicacion = dto.urlPublicacion;
    }
    if (dto.anonimo !== undefined) patch.anonimo = dto.anonimo;

    if (dto.plataformaId !== undefined || dto.plataformaOtra !== undefined) {
      const plataformaId =
        dto.plataformaId ?? (await this.currentPlatformId(idReporte, userId));
      const plataforma = await this.plataformaRepo.findOne({
        where: { idPlataforma: plataformaId },
      });
      if (!plataforma || !plataforma.activa) {
        throw new BadRequestException({
          message: 'La plataforma no existe o no está disponible.',
          code: 'CATALOG_INACTIVE',
        });
      }
      if (plataforma.esOtra && !dto.plataformaOtra) {
        throw new BadRequestException({
          message: 'Escribe el nombre de la plataforma en plataformaOtra.',
          code: 'PLATFORM_OTHER_REQUIRED',
        });
      }
      if (!plataforma.esOtra && dto.plataformaOtra) {
        throw new BadRequestException(
          'plataformaOtra solo se puede usar con la plataforma "Otra".',
        );
      }
      if (dto.plataformaId !== undefined) patch.idPlataforma = dto.plataformaId;
      patch.plataformaOtra = plataforma.esOtra ? dto.plataformaOtra : null;
    }

    if (dto.categoriaId !== undefined) {
      const categoria = await this.categoriaRepo.findOne({
        where: { idCategoria: dto.categoriaId },
      });
      if (!categoria || !categoria.activa) {
        throw new BadRequestException({
          message: 'La categoría no existe o no está disponible.',
          code: 'CATALOG_INACTIVE',
        });
      }
      patch.idCategoria = dto.categoriaId;
    }

    const result = await this.reporteRepo.update(
      { idReporte, idUsuario: userId, estado: 'pendiente' },
      patch,
    );

    if (!result.affected) {
      await this.assertEditable(idReporte, userId);
    }

    return this.getById(idReporte, userId);
  }

  async deleteReport(idReporte: number, userId: number): Promise<void> {
    const evidencias = await this.evidenciaRepo.find({ where: { idReporte } });

    const result = await this.reporteRepo.delete({
      idReporte,
      idUsuario: userId,
      estado: 'pendiente',
    });

    if (!result.affected) {
      await this.assertEditable(idReporte, userId);
      return;
    }

    await Promise.all(
      evidencias.map((evidencia) =>
        this.storageService
          .delete(evidencia.rutaArchivo)
          .catch(() => undefined),
      ),
    );
  }

  async like(idReporte: number, userId: number): Promise<LikeResponse> {
    const reporte = await this.reporteRepo.findOne({ where: { idReporte } });
    if (!reporte) {
      throw new NotFoundException();
    }
    if (reporte.idUsuario === userId) {
      throw new ForbiddenException({
        message: 'No puedes dar like a tu propio reporte.',
        code: 'OWN_REPORT',
      });
    }

    await this.dataSource.transaction(async (manager) => {
      let inserted = true;
      try {
        await manager.insert(LikeReporte, { idUsuario: userId, idReporte });
      } catch (error) {
        if (!isDuplicateKeyError(error)) {
          throw error;
        }
        inserted = false; // ya tenía like: idempotente (sección 7).
      }
      if (inserted) {
        await manager.increment(Reporte, { idReporte }, 'totalLikes', 1);
      }
    });

    const updated = await this.reporteRepo.findOne({ where: { idReporte } });
    return {
      totalLikes: updated?.totalLikes ?? reporte.totalLikes,
      likedByMe: true,
    };
  }

  async unlike(idReporte: number, userId: number): Promise<LikeResponse> {
    const reporte = await this.reporteRepo.findOne({ where: { idReporte } });
    if (!reporte) {
      throw new NotFoundException();
    }

    await this.dataSource.transaction(async (manager) => {
      const deleteResult = await manager.delete(LikeReporte, {
        idUsuario: userId,
        idReporte,
      });
      if (deleteResult.affected) {
        await manager.decrement(Reporte, { idReporte }, 'totalLikes', 1);
      }
    });

    const updated = await this.reporteRepo.findOne({ where: { idReporte } });
    return {
      totalLikes: updated?.totalLikes ?? reporte.totalLikes,
      likedByMe: false,
    };
  }

  /** Reporte inexistente o ajeno -> 404 (no revela que existe). Reporte propio ya revisado -> 400 REPORT_NOT_EDITABLE. */
  private async assertEditable(
    idReporte: number,
    userId: number,
  ): Promise<void> {
    const reporte = await this.reporteRepo.findOne({ where: { idReporte } });
    if (!reporte || reporte.idUsuario !== userId) {
      throw new NotFoundException();
    }
    throw new BadRequestException({
      message: 'El reporte ya fue revisado y no se puede modificar.',
      code: 'REPORT_NOT_EDITABLE',
    });
  }

  private async currentPlatformId(
    idReporte: number,
    userId: number,
  ): Promise<number> {
    const reporte = await this.reporteRepo.findOne({
      where: { idReporte, idUsuario: userId },
    });
    if (!reporte) {
      throw new NotFoundException();
    }
    return reporte.idPlataforma;
  }

  private async buildAssemblyContext(
    reportes: Reporte[],
    userId: number,
  ): Promise<ReportAssemblyContext> {
    const ids = reportes.map((r) => r.idReporte);
    if (ids.length === 0) {
      return {
        likedIds: new Set(),
        evidenciasByReporte: new Map(),
        revisionByReporte: new Map(),
        commentCountByReporte: new Map(),
      };
    }

    const [likes, evidencias, revisiones, commentCounts] = await Promise.all([
      this.likeRepo.find({ where: { idUsuario: userId, idReporte: In(ids) } }),
      this.evidenciaRepo.find({
        where: { idReporte: In(ids) },
        order: { idEvidencia: 'ASC' },
      }),
      this.revisionRepo.find({
        where: { idReporte: In(ids) },
        order: { fechaRevision: 'DESC' },
      }),
      this.reporteRepo.manager
        .getRepository(Comentario)
        .createQueryBuilder('c')
        .select('c.id_reporte', 'idReporte')
        .addSelect('COUNT(*)', 'total')
        .where('c.id_reporte IN (:...ids)', { ids })
        .andWhere("c.estado = 'visible'")
        .groupBy('c.id_reporte')
        .getRawMany<{ idReporte: number; total: string }>(),
    ]);

    const evidenciasByReporte = new Map<number, Evidencia[]>();
    for (const evidencia of evidencias) {
      const list = evidenciasByReporte.get(evidencia.idReporte) ?? [];
      list.push(evidencia);
      evidenciasByReporte.set(evidencia.idReporte, list);
    }

    const revisionByReporte = new Map<number, RevisionReporte>();
    for (const revision of revisiones) {
      if (!revisionByReporte.has(revision.idReporte)) {
        revisionByReporte.set(revision.idReporte, revision);
      }
    }

    const commentCountByReporte = new Map<number, number>();
    for (const row of commentCounts) {
      commentCountByReporte.set(Number(row.idReporte), Number(row.total));
    }

    return {
      likedIds: new Set(likes.map((l) => l.idReporte)),
      evidenciasByReporte,
      revisionByReporte,
      commentCountByReporte,
    };
  }

  private toResponse(
    reporte: Reporte,
    userId: number,
    context: ReportAssemblyContext,
  ): ReportResponse {
    const esMio = reporte.idUsuario === userId;
    const evidencias = context.evidenciasByReporte.get(reporte.idReporte) ?? [];
    const revision = context.revisionByReporte.get(reporte.idReporte) ?? null;

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
      autor: reporte.anonimo ? null : { nombre: reporte.usuario.nombre },
      esMio,
      likedByMe: context.likedIds.has(reporte.idReporte),
      totalLikes: reporte.totalLikes,
      totalComentarios:
        context.commentCountByReporte.get(reporte.idReporte) ?? 0,
      evidencias: evidencias.map((e) => ({
        id: e.idEvidencia,
        url: this.evidenceUrlService.buildSignedPath(e.idEvidencia),
      })),
      revision: revision
        ? {
            decision: revision.decision,
            comentario: revision.comentario,
            fecha: revision.fechaRevision.toISOString(),
          }
        : null,
      fechaCreacion: reporte.fechaCreacion.toISOString(),
      fechaActualizacion: reporte.fechaActualizacion.toISOString(),
    };
  }
}
