import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppConfigService } from '../config/app-config.service';
import { DiskStorageService } from './disk-storage.service';

describe('DiskStorageService', () => {
  let baseDir: string;
  let service: DiskStorageService;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'clicksafe-storage-'));
    const appConfig = { storageDir: baseDir } as unknown as AppConfigService;
    service = new DiskStorageService(appConfig);
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('guarda y lee un archivo dentro de STORAGE_DIR, creando subcarpetas', async () => {
    const data = Buffer.from('contenido de prueba');

    await service.save('evidencias/2026/09/archivo.webp', data);
    const read = await service.read('evidencias/2026/09/archivo.webp');

    expect(read.equals(data)).toBe(true);
  });

  it('borra un archivo existente', async () => {
    await service.save('a.webp', Buffer.from('x'));

    await service.delete('a.webp');

    await expect(service.read('a.webp')).rejects.toThrow();
  });

  it('no falla al borrar un archivo que no existe', async () => {
    await expect(service.delete('no-existe.webp')).resolves.toBeUndefined();
  });

  it('rechaza una ruta que intenta salir de STORAGE_DIR (path traversal)', async () => {
    await expect(
      service.save('../../fuera-de-storage.webp', Buffer.from('x')),
    ).rejects.toThrow('fuera de STORAGE_DIR');
  });
});
