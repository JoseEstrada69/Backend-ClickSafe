import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaginatedResponse } from '../common/interfaces/paginated-response.interface';
import { Notificacion, TipoNotificacion } from '../database/entities';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { NotificationResponse } from './dto/notification-response.dto';
import { UnreadCountResponse } from './dto/unread-count-response.dto';

/**
 * Notificaciones dentro de la app (sección 1, regla 9). Los mensajes se
 * generan aquí, nunca con el nombre de quien comentó — por eso create()
 * solo acepta un `mensaje` ya armado por el llamador con texto genérico.
 */
@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notificacion)
    private readonly notificacionRepo: Repository<Notificacion>,
  ) {}

  async create(
    idUsuario: number,
    idReporte: number,
    tipo: TipoNotificacion,
    mensaje: string,
  ): Promise<void> {
    await this.notificacionRepo.save(
      this.notificacionRepo.create({ idUsuario, idReporte, tipo, mensaje }),
    );
  }

  async list(
    userId: number,
    query: NotificationQueryDto,
  ): Promise<PaginatedResponse<NotificationResponse>> {
    const [rows, total] = await this.notificacionRepo.findAndCount({
      where: {
        idUsuario: userId,
        ...(query.leida !== undefined ? { leida: query.leida } : {}),
      },
      order: { fechaCreacion: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return {
      items: rows.map((n) => this.toResponse(n)),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  async unreadCount(userId: number): Promise<UnreadCountResponse> {
    const count = await this.notificacionRepo.count({
      where: { idUsuario: userId, leida: false },
    });
    return { count };
  }

  /** Solo propias (4.3): el UPDATE va condicionado a id + idUsuario en la misma consulta. */
  async markRead(idNotificacion: number, userId: number): Promise<void> {
    const result = await this.notificacionRepo.update(
      { idNotificacion, idUsuario: userId },
      { leida: true },
    );
    if (!result.affected) {
      throw new NotFoundException();
    }
  }

  async markAllRead(userId: number): Promise<void> {
    await this.notificacionRepo.update(
      { idUsuario: userId, leida: false },
      { leida: true },
    );
  }

  private toResponse(n: Notificacion): NotificationResponse {
    return {
      id: n.idNotificacion,
      tipo: n.tipo,
      mensaje: n.mensaje,
      leida: n.leida,
      reporteId: n.idReporte,
      fechaCreacion: n.fechaCreacion.toISOString(),
    };
  }
}
