import { Repository } from 'typeorm';
import { Usuario } from '../database/entities';
import { LockoutService } from './lockout.service';

describe('LockoutService', () => {
  let service: LockoutService;
  let repo: { update: jest.Mock };

  const buildUsuario = (overrides: Partial<Usuario> = {}): Usuario =>
    ({
      idUsuario: 1,
      intentosFallidos: 0,
      bloqueadoHasta: null,
      ...overrides,
    }) as Usuario;

  beforeEach(() => {
    repo = { update: jest.fn() };
    service = new LockoutService(repo as unknown as Repository<Usuario>);
  });

  it('isLocked es false si bloqueadoHasta es null', () => {
    expect(service.isLocked(buildUsuario())).toBe(false);
  });

  it('isLocked es true si bloqueadoHasta está en el futuro', () => {
    const usuario = buildUsuario({
      bloqueadoHasta: new Date(Date.now() + 60_000),
    });
    expect(service.isLocked(usuario)).toBe(true);
  });

  it('isLocked es false si bloqueadoHasta ya pasó', () => {
    const usuario = buildUsuario({
      bloqueadoHasta: new Date(Date.now() - 60_000),
    });
    expect(service.isLocked(usuario)).toBe(false);
  });

  it('incrementa intentosFallidos sin bloquear antes del quinto fallo', async () => {
    await service.registerFailedAttempt(buildUsuario({ intentosFallidos: 2 }));

    expect(repo.update).toHaveBeenCalledWith(1, { intentosFallidos: 3 });
  });

  it('bloquea 15 minutos al quinto fallo', async () => {
    await service.registerFailedAttempt(buildUsuario({ intentosFallidos: 4 }));

    const [, update] = repo.update.mock.calls[0] as [number, Partial<Usuario>];
    expect(update.intentosFallidos).toBe(5);
    expect(update.bloqueadoHasta).toBeInstanceOf(Date);
    const minutes = (update.bloqueadoHasta!.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14.9);
    expect(minutes).toBeLessThan(15.1);
  });

  it('duplica el bloqueo al décimo fallo (30 min)', async () => {
    await service.registerFailedAttempt(buildUsuario({ intentosFallidos: 9 }));

    const [, update] = repo.update.mock.calls[0] as [number, Partial<Usuario>];
    const minutes = (update.bloqueadoHasta!.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(29.9);
    expect(minutes).toBeLessThan(30.1);
  });

  it('no sigue incrementando si ya está bloqueado', async () => {
    const usuario = buildUsuario({
      bloqueadoHasta: new Date(Date.now() + 60_000),
    });

    await service.registerFailedAttempt(usuario);

    expect(repo.update).not.toHaveBeenCalled();
  });

  it('resetLockout reinicia el contador y el bloqueo', async () => {
    await service.resetLockout(1);

    expect(repo.update).toHaveBeenCalledWith(1, {
      intentosFallidos: 0,
      bloqueadoHasta: null,
    });
  });
});
