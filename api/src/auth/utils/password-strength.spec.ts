import { BadRequestException } from '@nestjs/common';
import { validatePasswordStrength } from './password-strength';

describe('validatePasswordStrength', () => {
  it('acepta una contraseña fuerte, sin relación con el correo o el nombre', () => {
    expect(() =>
      validatePasswordStrength('Xk9#mPq2vL7zT4', 'ana@example.com', 'Ana'),
    ).not.toThrow();
  });

  it('rechaza contraseñas menores a 8 caracteres', () => {
    expect(() =>
      validatePasswordStrength('Ab1#2', 'ana@example.com', 'Ana'),
    ).toThrow(BadRequestException);
  });

  it('rechaza contraseñas mayores a 128 caracteres', () => {
    expect(() =>
      validatePasswordStrength('a'.repeat(129), 'ana@example.com', 'Ana'),
    ).toThrow(BadRequestException);
  });

  it('rechaza una contraseña de la lista de comunes', () => {
    expect(() =>
      validatePasswordStrength('123456789', 'ana@example.com', 'Ana'),
    ).toThrow(/demasiado común/);
  });

  it('rechaza una contraseña que contiene el correo del usuario', () => {
    expect(() =>
      validatePasswordStrength(
        'ana12345contraseña',
        'ana@example.com',
        'Otro Nombre',
      ),
    ).toThrow(/correo/);
  });

  it('rechaza una contraseña que contiene el nombre del usuario', () => {
    expect(() =>
      validatePasswordStrength(
        'miguel12345seguro',
        'otro@example.com',
        'Miguel',
      ),
    ).toThrow(/nombre/);
  });
});
