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
}
