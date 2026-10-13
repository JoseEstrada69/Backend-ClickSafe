import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { CommentsModule } from '../comments/comments.module';
import { DatabaseModule } from '../database/database.module';
import { ReportsModule } from '../reports/reports.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    AuthModule,
    ReportsModule,
    CommentsModule,
  ],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
