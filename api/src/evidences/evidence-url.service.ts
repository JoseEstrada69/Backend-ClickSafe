import { createHmac } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { timingSafeEqualHex } from '../common/utils/timing-safe-equal-hex';

const SIGNED_URL_TTL_SECONDS = 15 * 60; // sección 6, punto 8

/**
 * Firma HMAC-SHA256(EVIDENCE_URL_SECRET, id:exp) para las URLs de
 * evidencias (sección 6, punto 8): así SwiftUI puede cargar imágenes sin
 * mandar el Authorization header y, aun así, el enlace no es permanente ni
 * adivinable (expira a los 15 min).
 */
@Injectable()
export class EvidenceUrlService {
  constructor(private readonly appConfig: AppConfigService) {}

  buildSignedPath(idEvidencia: number): string {
    const exp = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
    const sig = this.computeSignature(idEvidencia, exp);
    return `/api/v1/evidences/${idEvidencia}?exp=${exp}&sig=${sig}`;
  }

  verify(idEvidencia: number, exp: number, sig: string): boolean {
    if (!Number.isInteger(exp) || Math.floor(Date.now() / 1000) > exp) {
      return false;
    }
    const expected = this.computeSignature(idEvidencia, exp);
    return timingSafeEqualHex(expected, sig);
  }

  private computeSignature(idEvidencia: number, exp: number): string {
    return createHmac('sha256', this.appConfig.evidenceUrlSecret)
      .update(`${idEvidencia}:${exp}`)
      .digest('hex');
  }
}
