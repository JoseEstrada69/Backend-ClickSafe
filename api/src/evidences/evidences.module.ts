import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '../config/config.module';
import { Evidencia } from '../database/entities';
import { StorageModule } from '../storage/storage.module';
import { EvidencesController } from './evidences.controller';
import { EvidencesService } from './evidences.service';
import { EvidenceUrlService } from './evidence-url.service';
import { ImageProcessingService } from './image-processing.service';

@Module({
  imports: [TypeOrmModule.forFeature([Evidencia]), StorageModule, ConfigModule],
  controllers: [EvidencesController],
  providers: [EvidencesService, EvidenceUrlService, ImageProcessingService],
  exports: [EvidencesService, EvidenceUrlService, ImageProcessingService],
})
export class EvidencesModule {}
