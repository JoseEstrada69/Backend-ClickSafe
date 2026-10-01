import { ArgumentsHost, NotFoundException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AllExceptionsFilter } from './all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let logger: { setContext: jest.Mock; error: jest.Mock; warn: jest.Mock };
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  const buildHost = (requestId: string): ArgumentsHost => {
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    return {
      switchToHttp: () => ({
        getResponse: () => ({ status: statusMock }),
        getRequest: () => ({ id: requestId }),
      }),
    } as unknown as ArgumentsHost;
  };

  beforeEach(() => {
    logger = { setContext: jest.fn(), error: jest.fn(), warn: jest.fn() };
    filter = new AllExceptionsFilter(logger as unknown as PinoLogger);
  });

  it('formatea una HttpException con su status y mensaje reales', () => {
    const host = buildHost('req-1');
    filter.catch(new NotFoundException('Reporte no encontrado'), host);

    expect(statusMock).toHaveBeenCalledWith(404);
    expect(jsonMock).toHaveBeenCalledWith({
      statusCode: 404,
      error: 'Not Found',
      message: 'Reporte no encontrado',
      requestId: 'req-1',
    });
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('convierte un error no controlado en 500 genérico, sin exponer el mensaje real', () => {
    const host = buildHost('req-2');
    filter.catch(new Error('ECONNREFUSED 127.0.0.1:3306'), host);

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Ocurrió un error inesperado.',
      requestId: 'req-2',
    });
    expect(logger.error).toHaveBeenCalled();
  });

  it('usa "unknown" como requestId si la petición no tiene uno asignado', () => {
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status: statusMock }),
        getRequest: () => ({}),
      }),
    } as unknown as ArgumentsHost;

    filter.catch(new NotFoundException(), host);

    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'unknown' }),
    );
  });
});
