import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvConfig } from './env.schema';

/**
 * Envuelve ConfigService<EnvConfig> para exponer acceso tipado y agrupado
 * por tema, en vez de esparcir configService.get('X') por todo el código.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService<EnvConfig, true>) {}

  get nodeEnv(): EnvConfig['NODE_ENV'] {
    return this.configService.get('NODE_ENV', { infer: true });
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get port(): number {
    return this.configService.get('PORT', { infer: true });
  }

  get corsOrigins(): string[] {
    return this.configService.get('CORS_ORIGINS', { infer: true });
  }

  get trustProxy(): boolean {
    return this.configService.get('TRUST_PROXY', { infer: true });
  }

  get swaggerEnabled(): boolean {
    return this.configService.get('SWAGGER_ENABLED', { infer: true });
  }

  get jwt(): { accessSecret: string; issuer: string; audience: string } {
    return {
      accessSecret: this.configService.get('JWT_ACCESS_SECRET', {
        infer: true,
      }),
      issuer: this.configService.get('JWT_ISSUER', { infer: true }),
      audience: this.configService.get('JWT_AUDIENCE', { infer: true }),
    };
  }

  get throttle(): { ttlMs: number; limit: number } {
    return {
      ttlMs: this.configService.get('THROTTLE_TTL_MS', { infer: true }),
      limit: this.configService.get('THROTTLE_LIMIT', { infer: true }),
    };
  }

  get db(): {
    host: string;
    port: number;
    username: string;
    password: string;
    name: string;
  } {
    return {
      host: this.configService.get('DB_HOST', { infer: true }),
      port: this.configService.get('DB_PORT', { infer: true }),
      username: this.configService.get('DB_USERNAME', { infer: true }),
      password: this.configService.get('DB_PASSWORD', { infer: true }),
      name: this.configService.get('DB_NAME', { infer: true }),
    };
  }

  get mail(): { host: string; port: number; from: string } {
    return {
      host: this.configService.get('MAIL_HOST', { infer: true }),
      port: this.configService.get('MAIL_PORT', { infer: true }),
      from: this.configService.get('MAIL_FROM', { infer: true }),
    };
  }

  get storageDir(): string {
    return this.configService.get('STORAGE_DIR', { infer: true });
  }

  get seedAdmin(): { nombre?: string; correo?: string } {
    return {
      nombre: this.configService.get('SEED_ADMIN_NOMBRE', { infer: true }),
      correo: this.configService.get('SEED_ADMIN_CORREO', { infer: true }),
    };
  }
}
