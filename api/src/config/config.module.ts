import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { validateEnv } from './env.schema';
import { AppConfigService } from './app-config.service';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      // No cargar .env en producción: las variables se inyectan por el entorno.
      ignoreEnvFile: process.env.NODE_ENV === 'production',
      // Jest fija NODE_ENV=test automáticamente. Las pruebas e2e deben usar
      // su propia base (clicksafe_test, nunca clicksafe_db) y su propio
      // archivo de variables, para no escribir usuarios de prueba en la
      // base de desarrollo (7). El candado real (que el arranque falle si
      // DB_NAME no es clicksafe_test) está en env.schema.ts.
      envFilePath: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class ConfigModule {}
