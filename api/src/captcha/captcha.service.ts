import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { AppConfigService } from '../config/app-config.service';
import { CaptchaUsado } from '../database/entities';
import { timingSafeEqualHex } from '../common/utils/timing-safe-equal-hex';

export interface CaptchaChallenge {
  algorithm: 'SHA-256';
  challenge: string;
  maxnumber: number;
  salt: string;
  signature: string;
}

interface SolvedCaptchaPayload {
  algorithm: string;
  challenge: string;
  number: number;
  salt: string;
  signature: string;
}

const CHALLENGE_TTL_SECONDS = 5 * 60; // 5.2: expira en 5 min
const MAX_NUMBER = 100_000;

/**
 * Captcha proof-of-work estilo ALTCHA (5.2), implementado con node:crypto
 * en vez de la librería altcha-lib: esa librería solo publica ESM y rompe
 * la compilación CommonJS del proyecto (el mismo problema que ya forzó a
 * fijar versiones de varios paquetes @nestjs/* en fases anteriores).
 * CLAUDE.md permite explícitamente esta implementación manual como
 * alternativa.
 *
 * Diseño sin estado en el servidor hasta que se resuelve: el `number`
 * secreto nunca se guarda, solo challenge/salt/signature viajan al
 * cliente. El cliente debe encontrar por fuerza bruta un `number` entre
 * 0 y maxnumber tal que SHA-256(salt + number) == challenge.
 */
@Injectable()
export class CaptchaService {
  constructor(
    private readonly appConfig: AppConfigService,
    @InjectRepository(CaptchaUsado)
    private readonly captchaUsadoRepo: Repository<CaptchaUsado>,
  ) {}

  createChallenge(): CaptchaChallenge {
    const expires = Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SECONDS;
    const salt = `${randomBytes(12).toString('hex')}?expires=${expires}`;
    const number = randomInt(0, MAX_NUMBER);
    const challenge = this.sha256(salt + number.toString());
    const signature = this.hmac(challenge);

    return {
      algorithm: 'SHA-256',
      challenge,
      maxnumber: MAX_NUMBER,
      salt,
      signature,
    };
  }

  /**
   * Verifica un payload de captcha ya resuelto (JSON codificado en base64).
   * Nunca lanza: devuelve false ante cualquier payload inválido, expirado,
   * mal firmado o ya usado (ataque de repetición).
   */
  async verify(payloadBase64: string): Promise<boolean> {
    const payload = this.decode(payloadBase64);
    if (!payload) {
      return false;
    }

    const expectedSignature = this.hmac(payload.challenge);
    if (!timingSafeEqualHex(expectedSignature, payload.signature)) {
      return false;
    }

    const expires = this.extractExpires(payload.salt);
    if (expires === null || Date.now() / 1000 > expires) {
      return false;
    }

    const recomputed = this.sha256(payload.salt + payload.number.toString());
    if (recomputed !== payload.challenge) {
      return false;
    }

    return this.consume(payload.signature, expires);
  }

  /** Borra retos ya usados cuya expiración quedó atrás (5.2). */
  @Cron('0 * * * *')
  async limpiarExpirados(): Promise<void> {
    await this.captchaUsadoRepo.delete({ expiraEn: LessThan(new Date()) });
  }

  private async consume(
    signature: string,
    expiresUnix: number,
  ): Promise<boolean> {
    try {
      await this.captchaUsadoRepo.insert({
        firma: signature,
        expiraEn: new Date(expiresUnix * 1000),
      });
      return true;
    } catch {
      // Firma duplicada (PK ya existe): el captcha ya se usó.
      return false;
    }
  }

  private decode(payloadBase64: string): SolvedCaptchaPayload | null {
    try {
      const json = Buffer.from(payloadBase64, 'base64').toString('utf8');
      const data: unknown = JSON.parse(json);
      if (
        typeof data === 'object' &&
        data !== null &&
        'algorithm' in data &&
        'challenge' in data &&
        'number' in data &&
        'salt' in data &&
        'signature' in data &&
        data.algorithm === 'SHA-256' &&
        typeof data.challenge === 'string' &&
        typeof data.salt === 'string' &&
        typeof data.signature === 'string' &&
        typeof data.number === 'number' &&
        Number.isInteger(data.number) &&
        data.number >= 0
      ) {
        return data as unknown as SolvedCaptchaPayload;
      }
      return null;
    } catch {
      return null;
    }
  }

  private extractExpires(salt: string): number | null {
    const match = /\?expires=(\d+)$/.exec(salt);
    if (!match) {
      return null;
    }
    return Number(match[1]);
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private hmac(value: string): string {
    return createHmac('sha256', this.appConfig.captchaHmacKey)
      .update(value)
      .digest('hex');
  }
}
