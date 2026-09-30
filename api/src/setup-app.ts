import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json } from 'express';
import helmet from 'helmet';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';
import { AppConfigService } from './config/app-config.service';

/**
 * Configuración de la app (4.1), extraída de main.ts para que los tests e2e
 * ejerciten exactamente el mismo armado que producción (prefijo, helmet,
 * límite de body, CORS, ValidationPipe, Swagger condicional), sin duplicar
 * la lista ni dejar que ambas se desincronicen.
 */
export function setupApp(
  app: NestExpressApplication,
  appConfig: AppConfigService,
): void {
  app.use(requestIdMiddleware);
  app.use(helmet());
  app.use(json({ limit: '100kb' }));

  if (appConfig.corsOrigins.length > 0) {
    app.enableCors({ origin: appConfig.corsOrigins });
  }

  if (appConfig.trustProxy) {
    app.set('trust proxy', 1);
  }

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  if (appConfig.swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('ClickSafe API')
        .setDescription('API REST de ClickSafe')
        .setVersion('1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document);
  }
}
