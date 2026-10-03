import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigService } from '../config/app-config.service';
import { ConfigModule } from '../config/config.module';
import { ENTITIES, Usuario } from './entities';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [AppConfigService],
      useFactory: (appConfig: AppConfigService) => ({
        type: 'mysql',
        host: appConfig.db.host,
        port: appConfig.db.port,
        username: appConfig.db.username,
        password: appConfig.db.password,
        database: appConfig.db.name,
        entities: ENTITIES,
        // El esquema vive en database/clicksafe_db.sql y ya fue probado (2):
        // TypeORM nunca debe crear ni alterar tablas por su cuenta.
        synchronize: false,
        migrationsRun: false,
        // Todas las fechas en UTC (2).
        timezone: 'Z',
      }),
    }),
    // Usuario es la entidad transversal (auditoría, seed del admin, y la
    // autenticación de la Fase 3): su repositorio se expone aquí para no
    // repetir TypeOrmModule.forFeature([Usuario]) en cada módulo que la
    // use. El resto de entidades las registra su propio módulo de feature
    // (p. ej. BitacoraAuditoria en AuditModule) cuando exista.
    TypeOrmModule.forFeature([Usuario]),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
