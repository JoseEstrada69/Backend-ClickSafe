import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import {
  BitacoraAuditoria,
  CategoriaFraude,
  Comentario,
  DenunciaComentario,
  Evidencia,
  Plataforma,
  Reporte,
  RevisionReporte,
  Usuario,
} from '../database/entities';
import { EvidencesModule } from '../evidences/evidences.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../storage/storage.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Reporte,
      Evidencia,
      RevisionReporte,
      Comentario,
      DenunciaComentario,
      Usuario,
      BitacoraAuditoria,
      Plataforma,
      CategoriaFraude,
    ]),
    AuditModule,
    AuthModule, // SessionService.revokeAllForUser (suspensión de usuario)
    NotificationsModule,
    EvidencesModule, // EvidenceUrlService
    StorageModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
