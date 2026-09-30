import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AppConfigService } from './../src/config/app-config.service';
import { setupApp } from './../src/setup-app';

describe('App (e2e) — Fase 1: línea base de seguridad', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    setupApp(app, app.get(AppConfigService));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health es público y responde solo { status: "ok" }', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['x-request-id']).toBeDefined();
  });

  it('asigna un X-Request-Id distinto en cada petición', async () => {
    const first = await request(app.getHttpServer()).get('/api/v1/health');
    const second = await request(app.getHttpServer()).get('/api/v1/health');

    expect(first.headers['x-request-id']).not.toBe(
      second.headers['x-request-id'],
    );
  });

  it('aplica los headers de seguridad de helmet', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBeDefined();
  });

  it('una ruta inexistente devuelve 404 con el formato de error estándar, sin filtrar detalles internos', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/v1/no-existe',
    );
    const body = response.body as {
      statusCode: number;
      error: string;
      requestId: string;
    };

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ statusCode: 404, error: 'Not Found' });
    expect(typeof body.requestId).toBe('string');
    expect(body).not.toHaveProperty('stack');
    expect(JSON.stringify(body)).not.toMatch(/node_modules|\.ts:\d+|at Object/);
  });
});
