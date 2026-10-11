import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ClientInfo } from '../common/decorators/client-info.decorator';
import { Public } from '../common/decorators/public.decorator';
import type { AuthenticatedRequest } from '../common/interfaces/jwt-payload.interface';
import type { RequestMeta } from '../common/interfaces/request-meta.interface';
import {
  BEARER_AUTH_SCHEME_NAME,
  MFA_TOKEN_SCHEME_NAME,
} from '../common/swagger/bearer-auth.constant';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '../common/swagger/error-responses.decorator';
import { CaptchaService } from '../captcha/captcha.service';
import type { CaptchaChallenge } from '../captcha/captcha.service';
import { Usuario } from '../database/entities';
import { AuthService } from './auth.service';
import {
  GenericMessageResponse,
  MfaChallengeResponse,
  Setup2faResponse,
  TokensResponse,
} from './auth-responses.interface';
import { MfaAdmin } from './decorators/mfa-admin.decorator';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { MfaEnableDto } from './dto/mfa-enable.dto';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { MfaOrAdminSessionGuard } from './guards/mfa-or-admin-session.guard';
import { MfaService } from './mfa.service';
import { SessionService } from './session.service';

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
@ApiTooManyRequestsResponse()
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
  @ApiOkResponse({
    description:
      'Reto proof-of-work (5.2). Resuélvelo y manda el resultado en el campo `captcha`.',
  })
  getCaptcha(): CaptchaChallenge {
    return this.captchaService.createChallenge();
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({
    description:
      'Respuesta idéntica exista o no el correo (previene enumeración de usuarios, 5.3).',
  })
  @ApiBadRequestResponse(
    'Captcha inválido/expirado (CAPTCHA_INVALID), contraseña débil (PASSWORD_WEAK), o datos con formato inválido.',
  )
  register(
    @Body() dto: RegisterDto,
    @ClientInfo() client: RequestMeta,
  ): Promise<GenericMessageResponse> {
    return this.authService.register(dto, client);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Correo marcado como verificado.' })
  @ApiBadRequestResponse(
    'Código inválido o expirado (INVALID_CODE), o datos con formato inválido.',
    'INVALID_CODE',
  )
  async verifyEmail(
    @Body() dto: VerifyEmailDto,
    @ClientInfo() client: RequestMeta,
  ): Promise<GenericMessageResponse> {
    await this.authService.verifyEmail(dto, client);
    return { message: 'Correo verificado correctamente.' };
  }

  @Public()
  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({
    description: 'Respuesta idéntica exista o no el correo.',
  })
  @ApiBadRequestResponse(
    'Captcha inválido o expirado (CAPTCHA_INVALID), o datos con formato inválido.',
    'CAPTCHA_INVALID',
  )
  resendVerification(
    @Body() dto: ResendVerificationDto,
  ): Promise<GenericMessageResponse> {
    return this.authService.resendVerification(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    description:
      'Usuario normal: {accessToken, refreshToken, expiresIn}. Admin: {mfaRequired|mfaSetupRequired, mfaToken} (5.4).',
  })
  @ApiBadRequestResponse(
    'Captcha inválido o expirado (CAPTCHA_INVALID), o datos con formato inválido.',
    'CAPTCHA_INVALID',
  )
  @ApiUnauthorizedResponse(
    'Credenciales inválidas (correo, contraseña o cuenta bloqueada).',
  )
  @ApiForbiddenResponse('El correo aún no se verificó.', 'EMAIL_NOT_VERIFIED')
  login(
    @Body() dto: LoginDto,
    @ClientInfo() client: RequestMeta,
  ): Promise<TokensResponse | MfaChallengeResponse> {
    return this.authService.login(dto, client);
  }

  @Public()
  @UseGuards(MfaOrAdminSessionGuard)
  @Post('2fa/setup')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth(MFA_TOKEN_SCHEME_NAME)
  @ApiBearerAuth(BEARER_AUTH_SCHEME_NAME)
  @ApiOkResponse({
    description: 'Secreto generado: { otpauthUri, qrCodeDataUrl } (5.5).',
  })
  @ApiUnauthorizedResponse(
    'Falta el token, o es inválido/expiró (mfaToken de setup o access token de admin).',
  )
  setup2fa(@MfaAdmin() admin: Usuario): Promise<Setup2faResponse> {
    return this.mfaService.setup2fa(admin);
  }

  @Public()
  @UseGuards(MfaOrAdminSessionGuard)
  @Post('2fa/enable')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth(MFA_TOKEN_SCHEME_NAME)
  @ApiBearerAuth(BEARER_AUTH_SCHEME_NAME)
  @ApiOkResponse({ description: '2FA activado.' })
  @ApiBadRequestResponse(
    'Todavía no se llamó a /2fa/setup, o el código no tiene el formato esperado.',
  )
  @ApiUnauthorizedResponse(
    'Token inválido/expirado, código incorrecto, o cuenta bloqueada.',
  )
  async enable2fa(
    @Body() dto: MfaEnableDto,
    @MfaAdmin() admin: Usuario,
    @ClientInfo() client: RequestMeta,
  ): Promise<GenericMessageResponse> {
    await this.mfaService.enable2fa(admin, dto.codigo, client);
    return { message: '2FA activado correctamente.' };
  }

  @Public()
  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    description:
      'Código correcto: se emite la sesión completa, {accessToken, refreshToken, expiresIn}.',
  })
  @ApiBadRequestResponse('Datos con formato inválido.')
  @ApiUnauthorizedResponse(
    'mfaToken inválido/expirado, código incorrecto, o cuenta bloqueada.',
  )
  verify2fa(
    @Body() dto: MfaVerifyDto,
    @ClientInfo() client: RequestMeta,
  ): Promise<TokensResponse> {
    return this.mfaService.verify2fa(dto, client);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    description:
      'Nuevo par {accessToken, refreshToken, expiresIn} (rotación, 5.6).',
  })
  @ApiBadRequestResponse('Datos con formato inválido.')
  @ApiUnauthorizedResponse(
    'Refresh token inválido, expirado, ya reemplazado (reuso detectado, revoca toda la familia), o usuario inactivo.',
  )
  refresh(
    @Body() dto: RefreshDto,
    @ClientInfo() client: RequestMeta,
  ): Promise<TokensResponse> {
    return this.sessionService.refresh(dto.refreshToken, client);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth(BEARER_AUTH_SCHEME_NAME)
  @ApiNoContentResponse({ description: 'Sesión actual revocada.' })
  @ApiUnauthorizedResponse()
  async logout(
    @Req() req: AuthenticatedRequest,
    @ClientInfo() client: RequestMeta,
  ): Promise<void> {
    await this.sessionService.logout(
      Number(req.user?.sid),
      Number(req.user?.sub),
      client,
    );
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth(BEARER_AUTH_SCHEME_NAME)
  @ApiNoContentResponse({
    description: 'Todas las sesiones del usuario revocadas.',
  })
  @ApiUnauthorizedResponse()
  async logoutAll(
    @Req() req: AuthenticatedRequest,
    @ClientInfo() client: RequestMeta,
  ): Promise<void> {
    await this.sessionService.logoutAll(Number(req.user?.sub), client);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({
    description: 'Respuesta idéntica exista o no el correo (5.7).',
  })
  @ApiBadRequestResponse(
    'Captcha inválido o expirado (CAPTCHA_INVALID), o datos con formato inválido.',
    'CAPTCHA_INVALID',
  )
  forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @ClientInfo() client: RequestMeta,
  ): Promise<GenericMessageResponse> {
    return this.authService.forgotPassword(dto, client);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    description: 'Contraseña cambiada, sesiones revocadas (5.7).',
  })
  @ApiBadRequestResponse(
    'Captcha inválido/expirado (CAPTCHA_INVALID), código inválido/expirado (INVALID_CODE), contraseña débil (PASSWORD_WEAK), o datos con formato inválido.',
  )
  resetPassword(
    @Body() dto: ResetPasswordDto,
    @ClientInfo() client: RequestMeta,
  ): Promise<GenericMessageResponse> {
    return this.authService.resetPassword(dto, client);
  }
}
