import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CategoriaFraude,
  Comentario,
  Evidencia,
  LikeReporte,
  Plataforma,
  Reporte,
  RevisionReporte,
} from '../database/entities';
import { EvidencesModule } from '../evidences/evidences.module';
import { StorageModule } from '../storage/storage.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Reporte,
      Plataforma,
      CategoriaFraude,
      Evidencia,
      LikeReporte,
      RevisionReporte,
      Comentario,
    ]),
    EvidencesModule,
    StorageModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
