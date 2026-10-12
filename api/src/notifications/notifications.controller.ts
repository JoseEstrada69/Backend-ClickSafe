import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  Req,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../common/interfaces/jwt-payload.interface';
import { ParsePositiveIntPipe } from '../common/pipes/parse-positive-int.pipe';
import {
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '../common/swagger/error-responses.decorator';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { NotificationsService } from './notifications.service';

@ApiUnauthorizedResponse()
@ApiTooManyRequestsResponse()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOkResponse({ description: 'Notificaciones propias, paginadas.' })
  list(@Query() query: NotificationQueryDto, @Req() req: AuthenticatedRequest) {
    return this.notificationsService.list(Number(req.user?.sub), query);
  }

  @Get('unread-count')
  @ApiOkResponse({ description: '{ count }' })
  unreadCount(@Req() req: AuthenticatedRequest) {
    return this.notificationsService.unreadCount(Number(req.user?.sub));
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Notificación marcada como leída.' })
  async markRead(
    @Param('id', ParsePositiveIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.notificationsService.markRead(id, Number(req.user?.sub));
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({
    description: 'Todas las notificaciones marcadas como leídas.',
  })
  async markAllRead(@Req() req: AuthenticatedRequest): Promise<void> {
    await this.notificationsService.markAllRead(Number(req.user?.sub));
  }
}
