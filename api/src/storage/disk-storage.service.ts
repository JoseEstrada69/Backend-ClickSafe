import { Injectable } from '@nestjs/common';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { AppConfigService } from '../config/app-config.service';
import { StorageService } from './storage.service.interface';

/**
 * Implementación en disco de StorageService. `STORAGE_DIR` debe quedar
 * fuera de la carpeta del código (sección 6). Toda ruta recibida se
 * resuelve contra esa base y se verifica que el resultado siga DENTRO de
 * ella antes de tocar el filesystem — si no, se rechaza.
 */
@Injectable()
export class DiskStorageService implements StorageService {
  private readonly baseDir: string;

  constructor(appConfig: AppConfigService) {
    this.baseDir = resolve(appConfig.storageDir);
  }

  async save(relativePath: string, data: Buffer): Promise<void> {
    const absolutePath = this.resolveWithinBase(relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, data);
  }

  async read(relativePath: string): Promise<Buffer> {
    return readFile(this.resolveWithinBase(relativePath));
  }

  async delete(relativePath: string): Promise<void> {
    await rm(this.resolveWithinBase(relativePath), { force: true });
  }

  /**
   * Previene path traversal (sección 6, punto 5): una ruta como
   * "../../etc/passwd" resolvería fuera de baseDir y se rechaza aquí,
   * antes de cualquier operación de filesystem.
   */
  private resolveWithinBase(relativePath: string): string {
    const absolutePath = resolve(this.baseDir, relativePath);
    const isWithinBase =
      absolutePath === this.baseDir ||
      absolutePath.startsWith(this.baseDir + sep);
    if (!isWithinBase) {
      throw new Error('Ruta de almacenamiento fuera de STORAGE_DIR');
    }
    return absolutePath;
  }
}
