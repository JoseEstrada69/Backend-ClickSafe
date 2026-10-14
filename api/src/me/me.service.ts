import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { LockoutService } from '../auth/lockout.service';
import { RequestMeta, SessionService } from '../auth/session.service';
import { CommentsService } from '../comments/comments.service';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PaginatedResponse } from '../common/interfaces/paginated-response.interface';
import { hashPassword, verifyPassword } from '../common/utils/password-hash';
import { validatePasswordStrength } from '../auth/utils/password-strength';
import { Usuario } from '../database/entities';
import { MyCommentResponse } from '../comments/dto/comment-response.dto';
import { ReportResponse } from '../reports/dto/report-response.dto';
import { ReportsService } from '../reports/reports.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { MeResponse } from './dto/me-response.dto';

/** Perfil propio (secciones 5.6 y 7: GET/PATCH /me, PATCH /me/password, GET /me/reports, GET /me/comments). */
@Injectable()
export class MeService {
  constructor(
    private readonly auditService: AuditService,
    private readonly sessionService: SessionService,
    private readonly lockoutService: LockoutService,
    private readonly reportsService: ReportsService,
    private readonly commentsService: CommentsService,
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
  ) {}

  getMyReports(
    idUsuario: number,
    query: PaginationQueryDto,
  ): Promise<PaginatedResponse<ReportResponse>> {
    return this.reportsService.getMyReports(idUsuario, query);
  }

  getMyComments(
    idUsuario: number,
    query: PaginationQueryDto,
  ): Promise<PaginatedResponse<MyCommentResponse>> {
    return this.commentsService.listMyComments(idUsuario, query);
  }

  async getMe(idUsuario: number): Promise<MeResponse> {
    const usuario = await this.findOrThrow(idUsuario);
    return this.toResponse(usuario);
  }

  async updateMe(idUsuario: number, dto: UpdateMeDto): Promise<MeResponse> {
    await this.findOrThrow(idUsuario);
    await this.usuarioRepo.update(idUsuario, { nombre: dto.nombre });
    return this.getMe(idUsuario);
  }

  async changePassword(
    idUsuario: number,
    idSesionActual: number,
    dto: ChangePasswordDto,
    meta: RequestMeta = {},
  ): Promise<void> {
    const usuario = await this.findOrThrow(idUsuario);

    const passwordOk = await verifyPassword(
      usuario.passwordHash,
      dto.passwordActual,
    );
    if (!passwordOk) {
      // 400 (no 401, sección 7): un 401 aquí hace que algunos clientes lo
      // confundan con una sesión vencida y reintenten tras refrescar el
      // token, generando un segundo intento fallido que el usuario nunca
      // hizo. Sigue contando para el bloqueo progresivo (5.1/5.4) y se
      // audita, igual que un login fallido.
      await this.auditService.log({
        idUsuario,
        accion: 'password_cambio_fallo',
        resultado: 'fallo',
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      await this.lockoutService.registerFailedAttempt(usuario);
      throw new BadRequestException({
        message: 'La contraseña actual no es correcta.',
        code: 'INVALID_CURRENT_PASSWORD',
      });
    }

    validatePasswordStrength(dto.nuevaPassword, usuario.correo, usuario.nombre);

    const passwordHash = await hashPassword(dto.nuevaPassword);
    await this.usuarioRepo.update(idUsuario, { passwordHash });
    // Revoca las demás sesiones, pero no la actual (sección 7): así no se
    // cierra la sesión del dispositivo desde el que se hizo el cambio.
    await this.sessionService.revokeAllExceptCurrent(idUsuario, idSesionActual);
    await this.auditService.log({
      idUsuario,
      accion: 'password_cambiada',
      resultado: 'exito',
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  private async findOrThrow(idUsuario: number): Promise<Usuario> {
    const usuario = await this.usuarioRepo.findOne({ where: { idUsuario } });
    if (!usuario) {
      throw new NotFoundException();
    }
    return usuario;
  }

  private toResponse(usuario: Usuario): MeResponse {
    return {
      nombre: usuario.nombre,
      correo: usuario.correo,
      rol: usuario.rol,
      fechaRegistro: usuario.fechaRegistro.toISOString(),
      totpActivo: usuario.totpActivo,
    };
  }
}
