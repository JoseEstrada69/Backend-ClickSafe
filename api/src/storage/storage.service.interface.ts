export const STORAGE_SERVICE = Symbol('STORAGE_SERVICE');

/**
 * Interfaz de almacenamiento (sección 6, punto 7). La implementación actual
 * es en disco; más adelante habrá una para MinIO sin que los consumidores
 * (reports/evidences) cambien una sola línea.
 */
export interface StorageService {
  /** `relativePath` es una clave relativa (p. ej. evidencias/2026/09/<uuid>.webp). */
  save(relativePath: string, data: Buffer): Promise<void>;
  read(relativePath: string): Promise<Buffer>;
  delete(relativePath: string): Promise<void>;
}
