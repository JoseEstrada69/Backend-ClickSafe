import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedRequest } from '../common/interfaces/jwt-payload.interface';
import { ParsePositiveIntPipe } from '../common/pipes/parse-positive-int.pipe';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '../common/swagger/error-responses.decorator';
import { CommentsService } from './comments.service';
import { CreateFlagDto } from './dto/create-flag.dto';

@ApiUnauthorizedResponse()
@ApiTooManyRequestsResponse()
@Controller('comments')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Comentario borrado (lógicamente).' })
  async deleteComment(
    @Param('id', ParsePositiveIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.commentsService.deleteComment(id, Number(req.user?.sub));
  }

  @Post(':id/flags')
  @Throttle({
    default: {
      limit: () => Number(process.env.THROTTLE_FLAGS_LIMIT ?? 20),
      ttl: () => Number(process.env.THROTTLE_FLAGS_TTL_MS ?? 3_600_000),
    },
  })
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ description: 'Denuncia registrada.' })
  @ApiBadRequestResponse('Datos con formato inválido.')
  @ApiForbiddenResponse(
    'No puedes denunciar tu propio comentario.',
    'OWN_COMMENT',
  )
  async createFlag(
    @Param('id', ParsePositiveIntPipe) id: number,
    @Body() dto: CreateFlagDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.commentsService.createFlag(id, Number(req.user?.sub), dto);
  }
}
