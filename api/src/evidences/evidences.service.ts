import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Evidencia } from '../database/entities';
import { STORAGE_SERVICE } from '../storage/storage.service.interface';
import type { StorageService } from '../storage/storage.service.interface';
import { EvidenceUrlService } from './evidence-url.service';

export interface EvidenceFile {
  buffer: Buffer;
  contentType: string;
}

@Injectable()
export class EvidencesService {
  constructor(
    @InjectRepository(Evidencia)
    private readonly evidenciaRepo: Repository<Evidencia>,
    @Inject(STORAGE_SERVICE)
    private readonly storageService: StorageService,
    private readonly evidenceUrlService: EvidenceUrlService,
  ) {}

  /**
   * GET /evidences/:id?exp&sig (pública, sección 6 punto 8). 404 tanto si
   * la evidencia no existe como si la firma es inválida/expiró: nunca se
   * distingue para no confirmarle a quien adivina IDs cuáles sí existen.
   */
  async getSignedFile(
    idEvidencia: number,
    exp: number,
    sig: string,
  ): Promise<EvidenceFile> {
    if (!this.evidenceUrlService.verify(idEvidencia, exp, sig)) {
      throw new NotFoundException();
    }
    const evidencia = await this.evidenciaRepo.findOne({
      where: { idEvidencia },
    });
    if (!evidencia) {
      throw new NotFoundException();
    }
    const buffer = await this.storageService.read(evidencia.rutaArchivo);
    return { buffer, contentType: evidencia.tipoArchivo };
  }

  buildSignedUrl(idEvidencia: number): string {
    return this.evidenceUrlService.buildSignedPath(idEvidencia);
  }
}
