import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { TipoArchivoEvidencia } from '../database/entities';

const MAX_INPUT_PIXELS = 25_000_000; // previene "bombas de descompresión" (sección 6)
const MAX_DIMENSION_PX = 2048;
const WEBP_QUALITY = 80;
const SUPPORTED_SOURCE_FORMATS = new Set(['jpeg', 'png', 'webp']);

export interface ProcessedImage {
  buffer: Buffer;
  sizeBytes: number;
  sha256: string;
}

/**
 * Procesa evidencias subidas (sección 6). Nunca confía en el nombre de
 * archivo ni el Content-Type que manda el cliente — ambos los controla un
 * atacante; el formato real se detecta leyendo los bytes con sharp. Toda
 * imagen aceptada se re-codifica a WebP: sharp no copia metadatos a menos
 * que se llame a `.withMetadata()` (nunca se hace), así que EXIF/GPS se
 * pierde junto con cualquier contenido incrustado (polyglots).
 */
@Injectable()
export class ImageProcessingService {
  async process(buffer: Buffer): Promise<ProcessedImage> {
    let format: string | undefined;
    try {
      const metadata = await sharp(buffer, {
        limitInputPixels: MAX_INPUT_PIXELS,
      }).metadata();
      format = metadata.format;
    } catch {
      format = undefined;
    }

    if (!format || !SUPPORTED_SOURCE_FORMATS.has(format)) {
      throw new BadRequestException({
        message: 'El archivo no es una imagen JPEG, PNG o WebP válida.',
        code: 'INVALID_IMAGE',
      });
    }

    let webpBuffer: Buffer;
    try {
      webpBuffer = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
        .resize({
          width: MAX_DIMENSION_PX,
          height: MAX_DIMENSION_PX,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();
    } catch {
      throw new BadRequestException({
        message: 'El archivo no es una imagen JPEG, PNG o WebP válida.',
        code: 'INVALID_IMAGE',
      });
    }

    return {
      buffer: webpBuffer,
      sizeBytes: webpBuffer.length,
      sha256: createHash('sha256').update(webpBuffer).digest('hex'),
    };
  }

  generateFileName(): string {
    return `${randomUUID()}.webp`;
  }

  /** Ruta relativa dentro de STORAGE_DIR (sección 6, punto 5): evidencias/AAAA/MM/<uuid>.webp. */
  buildRelativePath(fileName: string, when: Date = new Date()): string {
    const year = when.getUTCFullYear();
    const month = String(when.getUTCMonth() + 1).padStart(2, '0');
    return `evidencias/${year}/${month}/${fileName}`;
  }

  get tipoArchivo(): TipoArchivoEvidencia {
    return 'image/webp';
  }
}
