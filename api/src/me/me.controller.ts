import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/interfaces/jwt-payload.interface';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { MeResponse } from './me-response.interface';
import { MeService } from './me.service';

@Controller('me')
export class MeController {
  constructor(private readonly meService: MeService) {}

  @Get()
  getMe(@Req() req: AuthenticatedRequest): Promise<MeResponse> {
    return this.meService.getMe(this.requireUserId(req));
  }

  @Patch()
  updateMe(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateMeDto,
  ): Promise<MeResponse> {
    return this.meService.updateMe(this.requireUserId(req), dto);
  }

  @Patch('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  changePassword(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    const idUsuario = this.requireUserId(req);
    const idSesion = Number(req.user?.sid);
    return this.meService.changePassword(idUsuario, idSesion, dto);
  }

  private requireUserId(req: AuthenticatedRequest): number {
    const idUsuario = req.user?.sub;
    if (idUsuario === undefined) {
      // JwtAuthGuard ya garantiza que haya usuario; esto solo documenta el invariante para el compilador.
      throw new UnauthorizedException();
    }
    return idUsuario;
  }
}
