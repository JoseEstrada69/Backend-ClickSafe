import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';

interface HealthStatus {
  status: 'ok';
}

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  check(): HealthStatus {
    return { status: 'ok' };
  }
}
