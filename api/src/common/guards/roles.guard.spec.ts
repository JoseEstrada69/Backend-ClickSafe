import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import type {
  AuthenticatedRequest,
  JwtAccessPayload,
} from '../interfaces/jwt-payload.interface';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  const buildContext = (user?: JwtAccessPayload): ExecutionContext =>
    ({
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
      switchToHttp: () => ({
        getRequest: (): Partial<AuthenticatedRequest> => ({ user }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new RolesGuard(reflector as unknown as Reflector);
  });

  it('permite el acceso si la ruta no exige ningún rol', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(buildContext())).toBe(true);
  });

  it('rechaza si no hay usuario autenticado', () => {
    reflector.getAllAndOverride.mockReturnValue(['admin']);
    expect(() => guard.canActivate(buildContext(undefined))).toThrow(
      ForbiddenException,
    );
  });

  it('rechaza si el rol del usuario no está en la lista permitida', () => {
    reflector.getAllAndOverride.mockReturnValue(['admin']);
    const user: JwtAccessPayload = {
      sub: 1,
      rol: 'usuario',
      sid: 'x',
      mfa: false,
    };
    expect(() => guard.canActivate(buildContext(user))).toThrow(
      ForbiddenException,
    );
  });

  it('rechaza a un admin sin 2FA completado', () => {
    reflector.getAllAndOverride.mockReturnValue(['admin']);
    const user: JwtAccessPayload = {
      sub: 1,
      rol: 'admin',
      sid: 'x',
      mfa: false,
    };
    expect(() => guard.canActivate(buildContext(user))).toThrow('2FA');
  });

  it('permite a un admin con 2FA completado', () => {
    reflector.getAllAndOverride.mockReturnValue(['admin']);
    const user: JwtAccessPayload = {
      sub: 1,
      rol: 'admin',
      sid: 'x',
      mfa: true,
    };
    expect(guard.canActivate(buildContext(user))).toBe(true);
  });
});
