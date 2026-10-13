import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import type { AuthenticatedRequest } from '../common/interfaces/jwt-payload.interface';
import { ParsePositiveIntPipe } from '../common/pipes/parse-positive-int.pipe';
import { ApiPaginatedResponse } from '../common/swagger/paginated-response.decorator';
import {
  ApiBadRequestResponse,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '../common/swagger/error-responses.decorator';
import { CommentsService } from './comments.service';
import { CommentResponse } from './dto/comment-response.dto';
import { CreateCommentDto } from './dto/create-comment.dto';

/** GET/POST /reports/:id/comments (sección 7). Controlador separado de ReportsController, mismo prefijo. */
@ApiUnauthorizedResponse()
@ApiTooManyRequestsResponse()
@Controller('reports')
export class ReportCommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Get(':id/comments')
  @ApiPaginatedResponse(
    CommentResponse,
    'Comentarios visibles de un reporte, paginados.',
  )
  listComments(
    @Param('id', ParsePositiveIntPipe) id: number,
    @Query() query: PaginationQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.commentsService.listComments(id, Number(req.user?.sub), query);
  }

  @Post(':id/comments')
  @Throttle({
    default: {
      limit: () => Number(process.env.THROTTLE_COMMENTS_LIMIT ?? 30),
      ttl: () => Number(process.env.THROTTLE_COMMENTS_TTL_MS ?? 3_600_000),
    },
  })
  @ApiCreatedResponse({
    description: 'Comentario creado.',
    type: CommentResponse,
  })
  @ApiBadRequestResponse('Datos con formato inválido.')
  createComment(
    @Param('id', ParsePositiveIntPipe) id: number,
    @Body() dto: CreateCommentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.commentsService.createComment(id, Number(req.user?.sub), dto);
  }
}
