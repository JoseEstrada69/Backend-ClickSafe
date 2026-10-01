import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('responde { status: "ok" } sin datos adicionales', () => {
    const controller = new HealthController();
    expect(controller.check()).toEqual({ status: 'ok' });
  });
});
