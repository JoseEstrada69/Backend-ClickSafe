import { createHmac, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfigService } from '../config/app-config.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import {
  TipoTokenVerificacion,
  TokenVerificacion,
  Usuario,
} from '../database/entities';
import { hashPassword, verifyPassword } from '../common/utils/password-hash';
import { timingSafeEqualHex } from '../common/utils/timing-safe-equal-hex';
import { CaptchaService } from '../captcha/captcha.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import {
  GenericMessageResponse,
  MfaChallengeResponse,
  TokensResponse,
} from './auth-responses.interface';
import { LockoutService } from './lockout.service';
import { MfaService } from './mfa.service';
import { RequestMeta, SessionService } from './session.service';
import { generateNumericCode } from './utils/generate-numeric-code';
import { validatePasswordStrength } from './utils/password-strength';

const CODE_LENGTHS: Record<TipoTokenVerificacion, number> = {
  verificacion_correo: 6,
  recuperacion_password: 8,
};
const CODE_TTL_MINUTES: Record<TipoTokenVerificacion, number> = {
  verificacion_correo: 30,
  recuperacion_password: 15,
};
const MAX_CODE_ATTEMPTS = 5;
const GENERIC_VERIFICATION_MESSAGE: GenericMessageResponse = {
  message: 'Si el correo es válido, recibirás un código de verificación.',
};
const GENERIC_RECOVERY_MESSAGE: GenericMessageResponse = {
  message: 'Si el correo es válido, recibirás un código de recuperación.',
};

let dummyHashPromise: Promise<string> | null = null;
/** Hash fijo para comparar con argon2 cuando el usuario no existe (timing-safety, 5.4). */
function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(randomBytes(32).toString('hex'));
  return dummyHashPromise;
}

function normalizeEmail(correo: string): string {
  return correo.trim().toLowerCase();
}

/** Ciclo de vida de credenciales (5.1, 5.3, 5.4, 5.7). El login de admins y el 2FA viven en MfaService. */
@Injectable()
export class AuthService {
  constructor(
    private readonly appConfig: AppConfigService,
    private readonly auditService: AuditService,
    private readonly mailService: MailService,
    private readonly captchaService: CaptchaService,
    private readonly lockoutService: LockoutService,
    private readonly sessionService: SessionService,
    private readonly mfaService: MfaService,
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
    @InjectRepository(TokenVerificacion)
    private readonly tokenRepo: Repository<TokenVerificacion>,
  ) {}

  async register(
    dto: RegisterDto,
    meta: RequestMeta = {},
  ): Promise<GenericMessageResponse> {
    await this.requireValidCaptcha(dto.captcha);

    const correo = normalizeEmail(dto.correo);
    validatePasswordStrength(dto.password, correo, dto.nombre);

    const existing = await this.usuarioRepo.findOne({ where: { correo } });
    if (existing) {
      // No revelar que ya existe: se avisa al dueño real, no se manda un código (previene enumeración).
      await this.mailService.send({
        to: correo,
        subject: 'Alguien intentó registrarse con tu correo en ClickSafe',
        text: 'Si no fuiste tú, puedes ignorar este mensaje. Tu cuenta no sufrió cambios.',
      });
      await this.auditService.log({
        idUsuario: existing.idUsuario,
        accion: 'registro',
        resultado: 'fallo',
        ip: meta.ip,
        userAgent: meta.userAgent,
        detalle: { razon: 'correo_ya_existe' },
      });
      return GENERIC_VERIFICATION_MESSAGE;
    }

    const passwordHash = await hashPassword(dto.password);
    const usuario = await this.usuarioRepo.save(
      this.usuarioRepo.create({
        nombre: dto.nombre,
        correo,
        passwordHash,
        rol: 'usuario',
      }),
    );
    await this.sendVerificationCode(usuario, 'verificacion_correo');
    await this.auditService.log({
      idUsuario: usuario.idUsuario,
      accion: 'registro',
      resultado: 'exito',
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return GENERIC_VERIFICATION_MESSAGE;
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<void> {
    const correo = normalizeEmail(dto.correo);
    const usuario = await this.usuarioRepo.findOne({ where: { correo } });
    if (!usuario) {
      throw this.invalidCodeError();
    }

    const token = await this.findUsableToken(
      usuario.idUsuario,
      'verificacion_correo',
    );
    if (!token) {
      throw this.invalidCodeError();
    }

    if (
      !this.checkCode(
        usuario.idUsuario,
        'verificacion_correo',
        dto.codigo,
        token,
      )
    ) {
      await this.tokenRepo.update(token.idToken, {
        intentos: token.intentos + 1,
      });
      throw this.invalidCodeError();
    }

    await this.tokenRepo.update(token.idToken, { usadoEn: new Date() });
    await this.usuarioRepo.update(usuario.idUsuario, {
      correoVerificado: true,
    });
    await this.auditService.log({
      idUsuario: usuario.idUsuario,
      accion: 'correo_verificado',
      resultado: 'exito',
    });
  }

  async resendVerification(
    dto: ResendVerificationDto,
  ): Promise<GenericMessageResponse> {
    await this.requireValidCaptcha(dto.captcha);

    const correo = normalizeEmail(dto.correo);
    const usuario = await this.usuarioRepo.findOne({ where: { correo } });
    if (usuario && !usuario.correoVerificado) {
      await this.sendVerificationCode(usuario, 'verificacion_correo');
    }
    return GENERIC_VERIFICATION_MESSAGE;
  }

  async login(
    dto: LoginDto,
    meta: RequestMeta = {},
  ): Promise<TokensResponse | MfaChallengeResponse> {
    await this.requireValidCaptcha(dto.captcha);

    const correo = normalizeEmail(dto.correo);
    const usuario = await this.usuarioRepo.findOne({ where: { correo } });

    // Siempre se ejecuta argon2.verify, exista o no el usuario, para que
    // el tiempo de respuesta no delate si el correo está registrado (5.4).
    const passwordHash = usuario?.passwordHash ?? (await getDummyHash());
    const passwordOk = await verifyPassword(passwordHash, dto.password);

    if (!usuario || !passwordOk) {
      await this.auditService.log({
        idUsuario: usuario?.idUsuario ?? null,
        accion: 'login',
        resultado: 'fallo',
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      if (usuario) {
        await this.lockoutService.registerFailedAttempt(usuario);
      }
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // A partir de aquí la contraseña es correcta: el orden de los
    // siguientes checks importa para no distinguir "bloqueado" de
    // "contraseña incorrecta" ante quien no la conoce.
    if (this.lockoutService.isLocked(usuario) || !usuario.activo) {
      await this.auditService.log({
        idUsuario: usuario.idUsuario,
        accion: this.lockoutService.isLocked(usuario)
          ? 'cuenta_bloqueada'
          : 'login',
        resultado: 'fallo',
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      throw new UnauthorizedException('Credenciales inválidas');
    }

    if (!usuario.correoVerificado) {
      throw new ForbiddenException({
        message: 'Verifica tu correo antes de iniciar sesión.',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

    await this.lockoutService.resetLockout(usuario.idUsuario);
    await this.auditService.log({
      idUsuario: usuario.idUsuario,
      accion: 'login',
      resultado: 'exito',
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    if (usuario.rol === 'admin') {
      return this.mfaService.issueMfaToken(usuario);
    }
    return this.sessionService.issueSession(usuario, meta);
  }

  async forgotPassword(
    dto: ForgotPasswordDto,
  ): Promise<GenericMessageResponse> {
    await this.requireValidCaptcha(dto.captcha);

    const correo = normalizeEmail(dto.correo);
    const usuario = await this.usuarioRepo.findOne({ where: { correo } });
    if (usuario && usuario.activo) {
      await this.sendVerificationCode(usuario, 'recuperacion_password');
      await this.auditService.log({
        idUsuario: usuario.idUsuario,
        accion: 'password_recuperacion_solicitada',
        resultado: 'exito',
      });
    }
    return GENERIC_RECOVERY_MESSAGE;
  }

  async resetPassword(
    dto: ResetPasswordDto,
    meta: RequestMeta = {},
  ): Promise<GenericMessageResponse> {
    await this.requireValidCaptcha(dto.captcha);

    const correo = normalizeEmail(dto.correo);
    const usuario = await this.usuarioRepo.findOne({ where: { correo } });
    if (!usuario) {
      throw this.invalidCodeError();
    }

    const token = await this.findUsableToken(
      usuario.idUsuario,
      'recuperacion_password',
    );
    if (!token) {
      throw this.invalidCodeError();
    }

    if (
      !this.checkCode(
        usuario.idUsuario,
        'recuperacion_password',
        dto.codigo,
        token,
      )
    ) {
      await this.tokenRepo.update(token.idToken, {
        intentos: token.intentos + 1,
      });
      throw this.invalidCodeError();
    }

    validatePasswordStrength(dto.nuevaPassword, correo, usuario.nombre);

    const passwordHash = await hashPassword(dto.nuevaPassword);
    await this.tokenRepo.update(token.idToken, { usadoEn: new Date() });
    await this.usuarioRepo.update(usuario.idUsuario, { passwordHash });
    await this.lockoutService.resetLockout(usuario.idUsuario);
    await this.sessionService.revokeAllForUser(usuario.idUsuario);
    await this.auditService.log({
      idUsuario: usuario.idUsuario,
      accion: 'password_cambiada',
      resultado: 'exito',
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    await this.mailService.send({
      to: usuario.correo,
      subject: 'Tu contraseña de ClickSafe fue cambiada',
      text: 'Si no fuiste tú, contacta a soporte de inmediato.',
    });

    return { message: 'Contraseña actualizada correctamente.' };
  }

  private async requireValidCaptcha(captcha: string): Promise<void> {
    const ok = await this.captchaService.verify(captcha);
    if (!ok) {
      throw new BadRequestException({
        message: 'Captcha inválido o expirado.',
        code: 'CAPTCHA_INVALID',
      });
    }
  }

  private invalidCodeError(): BadRequestException {
    return new BadRequestException({
      message: 'Código inválido o expirado.',
      code: 'INVALID_CODE',
    });
  }

  private async findUsableToken(
    idUsuario: number,
    tipo: TipoTokenVerificacion,
  ): Promise<TokenVerificacion | null> {
    const token = await this.tokenRepo.findOne({ where: { idUsuario, tipo } });
    if (
      !token ||
      token.usadoEn ||
      token.expiraEn.getTime() < Date.now() ||
      token.intentos >= MAX_CODE_ATTEMPTS
    ) {
      return null;
    }
    return token;
  }

  private checkCode(
    idUsuario: number,
    tipo: TipoTokenVerificacion,
    codigo: string,
    token: TokenVerificacion,
  ): boolean {
    const candidateHash = this.hashCode(idUsuario, tipo, codigo);
    return timingSafeEqualHex(candidateHash, token.tokenHash);
  }

  private async sendVerificationCode(
    usuario: Usuario,
    tipo: TipoTokenVerificacion,
  ): Promise<void> {
    const codigo = generateNumericCode(CODE_LENGTHS[tipo]);
    const tokenHash = this.hashCode(usuario.idUsuario, tipo, codigo);

    // Invalida códigos anteriores del mismo tipo (5.3).
    await this.tokenRepo.delete({ idUsuario: usuario.idUsuario, tipo });

    const expiraEn = new Date(Date.now() + CODE_TTL_MINUTES[tipo] * 60_000);
    await this.tokenRepo.save(
      this.tokenRepo.create({
        idUsuario: usuario.idUsuario,
        tipo,
        tokenHash,
        expiraEn,
      }),
    );

    const asunto =
      tipo === 'verificacion_correo'
        ? 'Verifica tu correo en ClickSafe'
        : 'Código para recuperar tu contraseña en ClickSafe';
    await this.mailService.send({
      to: usuario.correo,
      subject: asunto,
      text: `Tu código es ${codigo}. Vence en ${CODE_TTL_MINUTES[tipo]} minutos.`,
    });
  }

  private hashCode(
    idUsuario: number,
    tipo: TipoTokenVerificacion,
    codigo: string,
  ): string {
    return createHmac('sha256', this.appConfig.codeHmacKey)
      .update(`${idUsuario}:${tipo}:${codigo}`)
      .digest('hex');
  }
}
