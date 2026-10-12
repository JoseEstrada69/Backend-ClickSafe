import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Comentario, DenunciaComentario, Reporte } from '../database/entities';
import { NotificationsModule } from '../notifications/notifications.module';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { ReportCommentsController } from './report-comments.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Comentario, DenunciaComentario, Reporte]),
    NotificationsModule,
  ],
  controllers: [ReportCommentsController, CommentsController],
  providers: [CommentsService],
  exports: [CommentsService],
})
export class CommentsModule {}
