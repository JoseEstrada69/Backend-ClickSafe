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

  await app.listen(appConfig.port);
}

void bootstrap();
