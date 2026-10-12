import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';
import { setupApp } from './setup-app';

async function bootstrap(): Promise<void> {
  // bodyParser: false para fijar el límite de 100kb explícitamente (4.1),
  // en vez de depender del valor por defecto de Express.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });

  const appConfig = app.get(AppConfigService);

  app.useLogger(app.get(Logger));

  setupApp(app, appConfig);

  app.enableShutdownHooks();

  // En producción, la API SOLO escucha en localhost: Nginx (en la misma
  // máquina) es el único punto de entrada con TLS, nunca se expone la API
  // directo a la red (docs/despliegue.md). En desarrollo se deja en todas
  // las interfaces para poder probar desde el simulador/otro dispositivo.
  const host = appConfig.isProduction ? '127.0.0.1' : '0.0.0.0';
  await app.listen(appConfig.port, host);
}

void bootstrap();
