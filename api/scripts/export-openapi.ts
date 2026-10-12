import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument } from '../src/setup-app';

const OUTPUT_PATH = resolve(__dirname, '../../docs/openapi.json');

/**
 * npm run openapi:export (sección 9). Genera docs/openapi.json con el
 * MISMO builder que usa Swagger en /api/docs (buildOpenApiDocument), sin
 * levantar el servidor HTTP: la app se crea pero nunca se llama a
 * app.listen().
 */
async function run(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
  });

  try {
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );

    const document = buildOpenApiDocument(app);
    await mkdir(dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(
      OUTPUT_PATH,
      `${JSON.stringify(document, null, 2)}\n`,
      'utf8',
    );
    console.log(`OpenAPI exportado a ${OUTPUT_PATH}`);
  } finally {
    await app.close();
  }
}

void run();
