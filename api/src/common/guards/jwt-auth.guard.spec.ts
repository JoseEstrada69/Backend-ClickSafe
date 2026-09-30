import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AppConfigService } from '../../config/app-config.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthenticatedRequest } from '../interfaces/jwt-payload.interface';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let jwtService: { verifyAsync: jest.Mock };
  let appConfig: AppConfigService;

  const buildContext = (
    request: Partial<AuthenticatedRequest>,
  ): ExecutionContext =>
    ({
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    jwtService = { verifyAsync: jest.fn() };
    appConfig = {
      jwt: {
        accessSecret: 'secret',
        issuer: 'clicksafe-api',
        audience: 'clicksafe-app',
      },
    } as unknown as AppConfigService;

    guard = new JwtAuthGuard(
      reflector as unknown as Reflector,
      jwtService as unknown as JwtService,
      appConfig,
    );
  });

  it('permite el acceso sin token si la ruta es @Public()', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const context = buildContext({ headers: {} });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('rechaza la petición si no hay header Authorization', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const context = buildContext({ headers: {} });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rechaza la petición si el header no tiene el esquema Bearer', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const context = buildContext({
      headers: { authorization: 'Basic abc123' },
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('adjunta el payload a request.user cuando el token es válido', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const payload = { sub: 1, rol: 'usuario', sid: 'abc', mfa: false };
    jwtService.verifyAsync.mockResolvedValue(payload);
    const request: Partial<AuthenticatedRequest> = {
      headers: { authorization: 'Bearer valid.token.here' },
    };
    const context = buildContext(request);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual(payload);
    expect(jwtService.verifyAsync).toHaveBeenCalledWith('valid.token.here', {
      secret: 'secret',
      algorithms: ['HS256'],
      issuer: 'clicksafe-api',
      audience: 'clicksafe-app',
    });
  });

  it('rechaza con mensaje genérico si el token es inválido o expiró', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));
    const context = buildContext({
      headers: { authorization: 'Bearer expired.token' },
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Token inválido o expirado',
    );
  });
});
