import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../common/interfaces/jwt-payload.interface';
import { ParsePositiveIntPipe } from '../common/pipes/parse-positive-int.pipe';
import { BEARER_AUTH_SCHEME_NAME } from '../common/swagger/bearer-auth.constant';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '../common/swagger/error-responses.decorator';
import { AdminService } from './admin.service';
import { AdminReportQueryDto } from './dto/admin-report-query.dto';
import { AdminUserQueryDto } from './dto/admin-user-query.dto';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { ModerateCommentDto } from './dto/moderate-comment.dto';
import { ReviewReportDto } from './dto/review-report.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';

/** Todo bajo /admin exige rol admin + 2FA completado (RolesGuard, 4.3). */
@ApiBearerAuth(BEARER_AUTH_SCHEME_NAME)
@ApiUnauthorizedResponse()
@ApiForbiddenResponse('Requiere rol admin con 2FA completado.')
@ApiTooManyRequestsResponse()
@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('reports')
  @ApiOkResponse({
    description: 'Cola de reportes (por defecto, pendientes), con autor real.',
  })
  listReports(@Query() query: AdminReportQueryDto) {
    return this.adminService.listReports(query);
  }

  @Post('reports/:id/review')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Reporte revisado.' })
  @ApiBadRequestResponse('El reporte ya fue revisado.', 'REPORT_NOT_EDITABLE')
  @ApiForbiddenResponse('No puedes revisar tu propio reporte.', 'OWN_REPORT')
  async reviewReport(
    @Param('id', ParsePositiveIntPipe) id: number,
    @Body() dto: ReviewReportDto,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.adminService.reviewReport(id, Number(req.user?.sub), dto);
    return { message: 'Reporte revisado correctamente.' };
  }

  @Delete('reports/:id/evidences/:evidenceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Evidencia eliminada.' })
  async deleteEvidence(
    @Param('id', ParsePositiveIntPipe) id: number,
    @Param('evidenceId', ParsePositiveIntPipe) evidenceId: number,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.adminService.deleteEvidence(
      id,
      evidenceId,
      Number(req.user?.sub),
    );
  }

  @Get('comments/flagged')
  @ApiOkResponse({
    description:
      'Comentarios ocultos automáticamente o con denuncias pendientes.',
  })
  listFlaggedComments() {
    return this.adminService.listFlaggedComments();
  }

  @Patch('comments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Comentario moderado.' })
  async moderateComment(
    @Param('id', ParsePositiveIntPipe) id: number,
    @Body() dto: ModerateCommentDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.adminService.moderateComment(id, Number(req.user?.sub), dto);
  }

  @Get('users')
  @ApiOkResponse({
    description: 'Usuarios paginados, con búsqueda por nombre/correo.',
  })
  listUsers(@Query() query: AdminUserQueryDto) {
    return this.adminService.listUsers(query);
  }

  @Patch('users/:id/status')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Estado del usuario actualizado.' })
  @ApiBadRequestResponse(
    'No puedes cambiar tu propio estado, o dejarías el sistema sin admins activos.',
  )
  async updateUserStatus(
    @Param('id', ParsePositiveIntPipe) id: number,
    @Body() dto: UpdateUserStatusDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.adminService.updateUserStatus(id, Number(req.user?.sub), dto);
  }

  @Get('stats')
  @ApiOkResponse({
    description:
      'Estadísticas por plataforma (Otra agrupada), categoría y estado.',
  })
  getStats() {
    return this.adminService.getStats();
  }

  @Get('audit-log')
  @ApiOkResponse({
    description: 'Bitácora de auditoría, paginada y filtrable.',
  })
  getAuditLog(@Query() query: AuditLogQueryDto) {
    return this.adminService.getAuditLog(query);
  }
}
