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
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import { ClientInfo } from '../common/decorators/client-info.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../common/interfaces/jwt-payload.interface';
import type { RequestMeta } from '../common/interfaces/request-meta.interface';
import { ParsePositiveIntPipe } from '../common/pipes/parse-positive-int.pipe';
import { BEARER_AUTH_SCHEME_NAME } from '../common/swagger/bearer-auth.constant';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '../common/swagger/error-responses.decorator';
import { ApiPaginatedResponse } from '../common/swagger/paginated-response.decorator';
import { AdminService } from './admin.service';
import { AdminReportQueryDto } from './dto/admin-report-query.dto';
import { AdminUserQueryDto } from './dto/admin-user-query.dto';
import {
  AdminCategoryResponse,
  AdminPlatformResponse,
  AdminReportResponse,
  AdminStatsResponse,
  AdminUserResponse,
  AuditLogEntryResponse,
  FlaggedCommentResponse,
} from './dto/admin-response.dto';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { CreateAdminDto } from './dto/create-admin.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreatePlatformDto } from './dto/create-platform.dto';
import { ModerateCommentDto } from './dto/moderate-comment.dto';
import { ReviewReportDto } from './dto/review-report.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { UpdatePlatformDto } from './dto/update-platform.dto';
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
  @ApiPaginatedResponse(
    AdminReportResponse,
    'Cola de reportes (por defecto, pendientes), con autor real.',
  )
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
    type: [FlaggedCommentResponse],
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
  @ApiPaginatedResponse(
    AdminUserResponse,
    'Usuarios paginados, con búsqueda por nombre/correo.',
  )
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

  @Post('admins')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({
    description:
      'Admin creado. Recibe por correo un código de recuperación (5.7) para definir su contraseña.',
    type: AdminUserResponse,
  })
  @ApiBadRequestResponse('Datos con formato inválido.')
  @ApiUnauthorizedResponse(
    'El código TOTP de reautenticación (del admin que llama) es incorrecto o la cuenta está bloqueada.',
  )
  createAdmin(
    @Body() dto: CreateAdminDto,
    @Req() req: AuthenticatedRequest,
    @ClientInfo() client: RequestMeta,
  ): Promise<AdminUserResponse> {
    return this.adminService.createAdmin(dto, Number(req.user?.sub), client);
  }

  @Get('platforms')
  @ApiOkResponse({
    description: 'Todas las plataformas, activas e inactivas.',
    type: [AdminPlatformResponse],
  })
  listPlatforms(): Promise<AdminPlatformResponse[]> {
    return this.adminService.listPlatforms();
  }

  @Post('platforms')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({
    description: 'Plataforma creada.',
    type: AdminPlatformResponse,
  })
  @ApiBadRequestResponse('Datos con formato inválido.')
  createPlatform(
    @Body() dto: CreatePlatformDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<AdminPlatformResponse> {
    return this.adminService.createPlatform(dto, Number(req.user?.sub));
  }

  @Patch('platforms/:id')
  @ApiOkResponse({
    description: 'Plataforma actualizada.',
    type: AdminPlatformResponse,
  })
  @ApiBadRequestResponse(
    'No puedes desactivar la plataforma "Otra", o datos con formato inválido.',
  )
  updatePlatform(
    @Param('id', ParsePositiveIntPipe) id: number,
    @Body() dto: UpdatePlatformDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<AdminPlatformResponse> {
    return this.adminService.updatePlatform(id, dto, Number(req.user?.sub));
  }

  @Get('categories')
  @ApiOkResponse({
    description: 'Todas las categorías, activas e inactivas.',
    type: [AdminCategoryResponse],
  })
  listCategories(): Promise<AdminCategoryResponse[]> {
    return this.adminService.listCategories();
  }

  @Post('categories')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({
    description: 'Categoría creada.',
    type: AdminCategoryResponse,
  })
  @ApiBadRequestResponse('Datos con formato inválido.')
  createCategory(
    @Body() dto: CreateCategoryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<AdminCategoryResponse> {
    return this.adminService.createCategory(dto, Number(req.user?.sub));
  }

  @Patch('categories/:id')
  @ApiOkResponse({
    description: 'Categoría actualizada.',
    type: AdminCategoryResponse,
  })
  @ApiBadRequestResponse('Datos con formato inválido.')
  updateCategory(
    @Param('id', ParsePositiveIntPipe) id: number,
    @Body() dto: UpdateCategoryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<AdminCategoryResponse> {
    return this.adminService.updateCategory(id, dto, Number(req.user?.sub));
  }

  @Get('stats')
  @ApiOkResponse({
    description:
      'Estadísticas por plataforma (Otra agrupada), categoría y estado.',
    type: AdminStatsResponse,
  })
  getStats() {
    return this.adminService.getStats();
  }

  @Get('audit-log')
  @ApiPaginatedResponse(
    AuditLogEntryResponse,
    'Bitácora de auditoría, paginada y filtrable.',
  )
  getAuditLog(@Query() query: AuditLogQueryDto) {
    return this.adminService.getAuditLog(query);
  }
}
