import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BitacoraAuditoria } from '../database/entities';
import { AuditService } from './audit.service';

@Module({
  imports: [TypeOrmModule.forFeature([BitacoraAuditoria])],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
