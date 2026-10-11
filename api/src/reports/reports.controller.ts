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
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedRequest } from '../common/interfaces/jwt-payload.interface';
import { ParsePositiveIntPipe } from '../common/pipes/parse-positive-int.pipe';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '../common/swagger/error-responses.decorator';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportQueryDto } from './dto/report-query.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { ReportsService } from './reports.service';

const MAX_UPLOAD_FILES = 10; // tope flexible del interceptor; el límite real (5) lo exige el servicio con EVIDENCE_LIMIT.
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

@ApiUnauthorizedResponse()
@ApiTooManyRequestsResponse()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get()
  @ApiOkResponse({ description: 'Feed paginado de reportes.' })
  getFeed(@Query() query: ReportQueryDto, @Req() req: AuthenticatedRequest) {
    return this.reportsService.getFeed(query, Number(req.user?.sub));
  }

  @Get(':id')
  @ApiOkResponse({ description: 'Detalle de un reporte.' })
  getById(
    @Param('id', ParsePositiveIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.reportsService.getById(id, Number(req.user?.sub));
  }

  @Post()
  @Throttle({
    default: {
      limit: () => Number(process.env.THROTTLE_REPORTS_LIMIT ?? 10),
      ttl: () => Number(process.env.THROTTLE_REPORTS_TTL_MS ?? 3_600_000),
    },
  })
  @UseInterceptors(
    FilesInterceptor('evidencias', MAX_UPLOAD_FILES, {
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        titulo: { type: 'string' },
        descripcion: { type: 'string' },
        urlPublicacion: { type: 'string' },
        plataformaId: { type: 'integer' },
        plataformaOtra: { type: 'string' },
        categoriaId: { type: 'integer' },
        anonimo: { type: 'string', enum: ['true', 'false'] },
        evidencias: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
      },
    },
  })
  @ApiCreatedResponse({ description: 'Reporte creado.' })
  @ApiBadRequestResponse(
    'Catálogo inactivo (CATALOG_INACTIVE), falta plataformaOtra (PLATFORM_OTHER_REQUIRED), más de 5 imágenes (EVIDENCE_LIMIT), imagen inválida (INVALID_IMAGE), o datos con formato inválido.',
  )
  createReport(
    @Body() dto: CreateReportDto,
    @UploadedFiles() files: { buffer: Buffer }[] | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.reportsService.createReport(
      dto,
      files ?? [],
      Number(req.user?.sub),
    );
  }

  @Patch(':id')
  @ApiOkResponse({ description: 'Reporte actualizado.' })
  @ApiBadRequestResponse(
    'Reporte ya revisado (REPORT_NOT_EDITABLE), catálogo inactivo (CATALOG_INACTIVE), falta plataformaOtra (PLATFORM_OTHER_REQUIRED), o datos con formato inválido.',
    'REPORT_NOT_EDITABLE',
  )
  updateReport(
    @Param('id', ParsePositiveIntPipe) id: number,
    @Body() dto: UpdateReportDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.reportsService.updateReport(id, Number(req.user?.sub), dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Reporte borrado.' })
  @ApiBadRequestResponse(
    'El reporte ya fue revisado y no se puede borrar.',
    'REPORT_NOT_EDITABLE',
  )
  async deleteReport(
    @Param('id', ParsePositiveIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.reportsService.deleteReport(id, Number(req.user?.sub));
  }

  @Post(':id/like')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: '{ totalLikes, likedByMe }' })
  @ApiForbiddenResponse('No puedes dar like a tu propio reporte.', 'OWN_REPORT')
  like(
    @Param('id', ParsePositiveIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.reportsService.like(id, Number(req.user?.sub));
  }

  @Delete(':id/like')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: '{ totalLikes, likedByMe }' })
  unlike(
    @Param('id', ParsePositiveIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.reportsService.unlike(id, Number(req.user?.sub));
  }
}
