import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { ParsePositiveIntPipe } from '../common/pipes/parse-positive-int.pipe';
import { EvidencesService } from './evidences.service';

/**
 * Sirve el archivo de una evidencia vía URL firmada (sección 6, punto 8).
 * @Public() a propósito: SwiftUI carga imágenes sin mandar Authorization.
 */
@Controller('evidences')
export class EvidencesController {
  constructor(private readonly evidencesService: EvidencesService) {}

  @Public()
  @Get(':id')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'")
  @Header('Cache-Control', 'private, max-age=900')
  @ApiOkResponse({ description: 'Imagen de la evidencia (WebP).' })
  async getEvidence(
    @Param('id', ParsePositiveIntPipe) id: number,
    @Query('exp') expRaw: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ): Promise<void> {
    const exp = Number(expRaw);
    if (!Number.isInteger(exp) || typeof sig !== 'string' || sig.length === 0) {
      throw new NotFoundException();
    }
    const file = await this.evidencesService.getSignedFile(id, exp, sig);
    res.setHeader('Content-Type', file.contentType);
    res.send(file.buffer);
  }
}
