import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PaginatedResponse } from '../common/interfaces/paginated-response.interface';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { isDuplicateKeyError } from '../common/utils/is-duplicate-key-error';
import { Comentario, DenunciaComentario, Reporte } from '../database/entities';
import { NotificationsService } from '../notifications/notifications.service';
import { CommentResponse } from './comment-response.interface';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CreateFlagDto } from './dto/create-flag.dto';

const FLAG_THRESHOLD = 3; // sección 1, regla 6: 3 denuncias de usuarios distintos.

/**
 * Comentarios y denuncias (sección 1, reglas 5 y 6). Moderación híbrida:
 * al llegar al umbral, el propio servicio oculta el comentario en la misma
 * transacción que inserta la denuncia — nunca lo decide un admin a mano.
 */
@Injectable()
export class CommentsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Comentario)
    private readonly comentarioRepo: Repository<Comentario>,
    @InjectRepository(Reporte)
    private readonly reporteRepo: Repository<Reporte>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async listComments(
    idReporte: number,
    userId: number,
    query: PaginationQueryDto,
  ): Promise<PaginatedResponse<CommentResponse>> {
    const reporte = await this.reporteRepo.findOne({ where: { idReporte } });
    if (!reporte) {
      throw new NotFoundException();
    }

    const [rows, total] = await this.comentarioRepo.findAndCount({
      where: { idReporte, estado: 'visible' },
      relations: { usuario: true },
      order: { fechaCreacion: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return {
      items: rows.map((c) => this.toResponse(c, userId)),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  async createComment(
    idReporte: number,
    userId: number,
    dto: CreateCommentDto,
  ): Promise<CommentResponse> {
    const reporte = await this.reporteRepo.findOne({ where: { idReporte } });
    if (!reporte) {
      throw new NotFoundException();
    }

    const saved = await this.comentarioRepo.save(
      this.comentarioRepo.create({
        idReporte,
        idUsuario: userId,
        contenido: dto.contenido,
        anonimo: dto.anonimo,
      }),
    );

    // Nunca se incluye el nombre de quien comentó (sección 1, regla 9), y
    // nunca se notifica al propio autor por comentar en su propio reporte.
    if (reporte.idUsuario !== userId) {
      await this.notificationsService.create(
        reporte.idUsuario,
        idReporte,
        'nuevo_comentario',
        'Tu reporte recibió un nuevo comentario.',
      );
    }

    const withAuthor = await this.comentarioRepo.findOne({
      where: { idComentario: saved.idComentario },
      relations: { usuario: true },
    });
    return this.toResponse(withAuthor as Comentario, userId);
  }

  /** Solo el autor, y solo borrado lógico (4.3): el UPDATE va condicionado a id + idUsuario. */
  async deleteComment(idComentario: number, userId: number): Promise<void> {
    const result = await this.comentarioRepo.update(
      { idComentario, idUsuario: userId },
      { estado: 'eliminado' },
    );
    if (!result.affected) {
      throw new NotFoundException();
    }
  }

  async createFlag(
    idComentario: number,
    userId: number,
    dto: CreateFlagDto,
  ): Promise<void> {
    const comentario = await this.comentarioRepo.findOne({
      where: { idComentario },
    });
    if (!comentario || comentario.estado === 'eliminado') {
      throw new NotFoundException();
    }
    if (comentario.idUsuario === userId) {
      throw new ForbiddenException({
        message: 'No puedes denunciar tu propio comentario.',
        code: 'OWN_COMMENT',
      });
    }

    await this.dataSource.transaction(async (manager) => {
      try {
        await manager.insert(DenunciaComentario, {
          idComentario,
          idUsuario: userId,
          motivo: dto.motivo,
          detalle: dto.detalle ?? null,
        });
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          throw new ConflictException({
            message: 'Ya denunciaste este comentario.',
            code: 'ALREADY_FLAGGED',
          });
        }
        throw error;
      }

      await manager.increment(
        Comentario,
        { idComentario },
        'totalDenuncias',
        1,
      );

      const fresh = await manager.findOne(Comentario, {
        where: { idComentario },
      });
      if (
        fresh &&
        fresh.estado === 'visible' &&
        fresh.totalDenuncias >= FLAG_THRESHOLD
      ) {
        await manager.update(
          Comentario,
          { idComentario },
          { estado: 'oculto_auto' },
        );
      }
    });
  }

  private toResponse(comentario: Comentario, userId: number): CommentResponse {
    return {
      id: comentario.idComentario,
      contenido: comentario.contenido,
      anonimo: comentario.anonimo,
      autor: comentario.anonimo ? null : { nombre: comentario.usuario.nombre },
      esMio: comentario.idUsuario === userId,
      fechaCreacion: comentario.fechaCreacion.toISOString(),
    };
  }
}
