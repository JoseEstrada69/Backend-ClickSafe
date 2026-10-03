import { Repository } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { BitacoraAuditoria } from '../database/entities';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  let service: AuditService;
  let repository: { insert: jest.Mock };
  let logger: { setContext: jest.Mock; error: jest.Mock };

  beforeEach(() => {
    repository = { insert: jest.fn() };
    logger = { setContext: jest.fn(), error: jest.fn() };
    service = new AuditService(
      repository as unknown as Repository<BitacoraAuditoria>,
      logger as unknown as PinoLogger,
    );
  });

  it('inserta el evento con null en los campos opcionales que no se pasan', async () => {
    repository.insert.mockResolvedValue(undefined);

    await service.log({ accion: 'login', resultado: 'exito' });

    expect(repository.insert).toHaveBeenCalledWith({
      idUsuario: null,
      accion: 'login',
      resultado: 'exito',
      recursoTipo: null,
      recursoId: null,
      ip: null,
      userAgent: null,
      detalle: null,
    });
  });

  it('pasa los campos opcionales cuando sí se proporcionan', async () => {
    repository.insert.mockResolvedValue(undefined);

    await service.log({
      idUsuario: 7,
      accion: 'admin_creado',
      resultado: 'exito',
      recursoTipo: 'Usuario',
      recursoId: 7,
      ip: '10.0.0.1',
      userAgent: 'jest',
      detalle: { via: 'seed' },
    });

    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ idUsuario: 7, detalle: { via: 'seed' } }),
    );
  });

  it('no lanza si falla el insert: solo se registra en el log de la app (4.6)', async () => {
    repository.insert.mockRejectedValue(new Error('conexión perdida'));

    await expect(
      service.log({ accion: 'login', resultado: 'fallo' }),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});
