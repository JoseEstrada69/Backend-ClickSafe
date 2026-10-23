import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { json } from 'express';
import helmet from 'helmet';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';
import {
  BEARER_AUTH_SCHEME_NAME,
  MFA_TOKEN_SCHEME_NAME,
} from './common/swagger/bearer-auth.constant';
import { AppConfigService } from './config/app-config.service';

/**
 * Único lugar donde se arma el documento OpenAPI: lo usan tanto
 * setupApp() (Swagger en /api/docs cuando SWAGGER_ENABLED=true) como
 * scripts/export-openapi.ts (docs/openapi.json), para que nunca queden
 * desincronizados.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  return SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('ClickSafe API')
      .setDescription('API REST de ClickSafe')
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        BEARER_AUTH_SCHEME_NAME,
      )
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        MFA_TOKEN_SCHEME_NAME,
      )
      // Sin esto, @nestjs/swagger deja "servers": [] -- válido para el
      // propio esquema, pero varias herramientas que SÍ necesitan saber a
      // dónde mandar peticiones (p. ej. el importador de OpenAPI de ZAP)
      // lo rechazan como documento inválido. "/" es relativo a propósito
      // (se resuelve contra el origen desde donde se importe el
      // documento, sea cual sea el host/puerto real).
      .addServer('/')
      .build(),
  );
}

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
    SwaggerModule.setup('api/docs', app, buildOpenApiDocument(app));
  }
}
