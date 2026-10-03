import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { CaptchaModule } from '../captcha/captcha.module';
import { ConfigModule } from '../config/config.module';
import { DatabaseModule } from '../database/database.module';
import { TokenVerificacion } from '../database/entities';
import { MailModule } from '../mail/mail.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LockoutService } from './lockout.service';
import { MfaService } from './mfa.service';
import { SessionService } from './session.service';

@Module({
  imports: [
    ConfigModule,
    AuditModule,
    MailModule,
    CaptchaModule,
    // DatabaseModule ya expone los repositorios de Usuario y Sesion
    // (transversales); aquí solo se agrega el propio de este módulo.
    DatabaseModule,
    TypeOrmModule.forFeature([TokenVerificacion]),
  ],
  controllers: [AuthController],
  providers: [AuthService, SessionService, MfaService, LockoutService],
  exports: [SessionService],
})
export class AuthModule {}
