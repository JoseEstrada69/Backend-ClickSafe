import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import type { Request } from 'express';
import { AppConfigService } from './config/app-config.service';
import { ConfigModule } from './config/config.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { HealthModule } from './health/health.module';
import { DatabaseModule } from './database/database.module';
import { AuditModule } from './audit/audit.module';
import { MailModule } from './mail/mail.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [AppConfigService],
      useFactory: (appConfig: AppConfigService) => ({
        pinoHttp: {
          level: appConfig.isProduction ? 'info' : 'debug',
          // requestIdMiddleware (main.ts) ya asignó req.id antes de llegar aquí.
          genReqId: (req: Request) => req.id,
          transport: appConfig.isProduction
            ? undefined
            : {
                target: 'pino-pretty',
                options: { colorize: true, singleLine: true },
              },
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.body.password',
              'req.body.passwordActual',
              'req.body.nuevaPassword',
              'req.body.token',
              'req.body.refreshToken',
              'req.body.codigo',
              'req.body.totp',
            ],
            censor: '[REDACTED]',
          },
        },
      }),
    }),
    // JwtModule global: el secreto se pasa por-llamada en JwtAuthGuard
    // (verifyAsync), no aquí, para poder usar el mismo servicio con
    // distintos secretos (access vs. mfa) en fases futuras.
    JwtModule.register({ global: true }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [AppConfigService, JwtService],
      useFactory: (appConfig: AppConfigService, jwtService: JwtService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: appConfig.throttle.ttlMs,
            limit: appConfig.throttle.limit,
          },
        ],
        // 4.4: el límite es por usuario (sub del token) si hay token, si no por IP.
        // Solo se decodifica (no se verifica) el token: alcanza para agrupar el
        // conteo de peticiones y no afecta la autorización real, que hace
        // JwtAuthGuard por separado.
        getTracker: (req: Record<string, unknown>): string => {
          const request = req as unknown as Request;
          const header = request.headers.authorization;
          if (header?.startsWith('Bearer ')) {
            const token = header.slice('Bearer '.length);
            const decoded = jwtService.decode<{ sub?: unknown }>(token);
            if (decoded && typeof decoded.sub === 'number') {
              return `user:${decoded.sub}`;
            }
          }
          return `ip:${request.ip ?? 'unknown'}`;
        },
      }),
    }),
    DatabaseModule,
    AuditModule,
    MailModule,
    StorageModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
