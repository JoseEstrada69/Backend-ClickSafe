import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { DiskStorageService } from './disk-storage.service';
import { STORAGE_SERVICE } from './storage.service.interface';

@Module({
  imports: [ConfigModule],
  providers: [{ provide: STORAGE_SERVICE, useClass: DiskStorageService }],
  exports: [STORAGE_SERVICE],
})
export class StorageModule {}
