import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import type { AuthenticatedRequest } from '../common/interfaces/jwt-payload.interface';
import { CaptchaService } from '../captcha/captcha.service';
import type { CaptchaChallenge } from '../captcha/captcha.service';
import { AuthService } from './auth.service';
import {
  GenericMessageResponse,
  MfaChallengeResponse,
  Setup2faResponse,
  TokensResponse,
} from './auth-responses.interface';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { MfaEnableDto } from './dto/mfa-enable.dto';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { MfaService } from './mfa.service';
import { RequestMeta, SessionService } from './session.service';

/**
 * Sobrescribe el throttler 'default' solo en /auth/* (4.4: 5/min por IP).
 * Los valores se leen en tiempo de petición (no al cargar el decorador),
 * por eso son funciones: para entonces ConfigModule ya cargó el .env.
 */
@Throttle({
  default: {
    limit: () => Number(process.env.THROTTLE_AUTH_LIMIT ?? 5),
    ttl: () => Number(process.env.THROTTLE_AUTH_TTL_MS ?? 60_000),
  },
})
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly mfaService: MfaService,
    private readonly sessionService: SessionService,
    private readonly captchaService: CaptchaService,
  ) {}

  @Public()
  @Get('captcha')
  getCaptcha(): CaptchaChallenge {
    return this.captchaService.createChallenge();
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  register(
    @Body() dto: RegisterDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ): Promise<GenericMessageResponse> {
    return this.authService.register(dto, { ip, userAgent });
  }

  @Public()
  @Post('verify-email')
  async verifyEmail(
    @Body() dto: VerifyEmailDto,
  ): Promise<GenericMessageResponse> {
    await this.authService.verifyEmail(dto);
    return { message: 'Correo verificado correctamente.' };
  }

  @Public()
  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  resendVerification(
    @Body() dto: ResendVerificationDto,
  ): Promise<GenericMessageResponse> {
    return this.authService.resendVerification(dto);
  }

  @Public()
  @Post('login')
  login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ): Promise<TokensResponse | MfaChallengeResponse> {
    return this.authService.login(dto, { ip, userAgent });
  }

  @Public()
  @Post('2fa/setup')
  async setup2fa(
    @Headers('authorization') authorization?: string,
  ): Promise<Setup2faResponse> {
    const admin =
      await this.mfaService.resolveAdminFromMfaOrSession(authorization);
    return this.mfaService.setup2fa(admin);
  }

  @Public()
  @Post('2fa/enable')
  async enable2fa(
    @Body() dto: MfaEnableDto,
    @Headers('authorization') authorization?: string,
  ): Promise<GenericMessageResponse> {
    const admin =
      await this.mfaService.resolveAdminFromMfaOrSession(authorization);
    await this.mfaService.enable2fa(admin, dto.codigo);
    return { message: '2FA activado correctamente.' };
  }

  @Public()
  @Post('2fa/verify')
  verify2fa(
    @Body() dto: MfaVerifyDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ): Promise<TokensResponse> {
    return this.mfaService.verify2fa(dto, { ip, userAgent });
  }

  @Public()
  @Post('refresh')
  refresh(
    @Body() dto: RefreshDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ): Promise<TokensResponse> {
    const meta: RequestMeta = { ip, userAgent };
    return this.sessionService.refresh(dto.refreshToken, meta);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: AuthenticatedRequest): Promise<void> {
    await this.sessionService.logout(Number(req.user?.sid));
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(@Req() req: AuthenticatedRequest): Promise<void> {
    await this.sessionService.logoutAll(Number(req.user?.sub));
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<GenericMessageResponse> {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @Post('reset-password')
  resetPassword(
    @Body() dto: ResetPasswordDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ): Promise<GenericMessageResponse> {
    return this.authService.resetPassword(dto, { ip, userAgent });
  }
}
