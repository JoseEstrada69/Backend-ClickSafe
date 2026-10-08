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

  it('rechaza una contraseña que contiene la parte local completa del correo (>= 4 caracteres)', () => {
    expect(() =>
      validatePasswordStrength(
        'anab12345contraseña',
        'anab@example.com',
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

  // Casos reportados al probar en Swagger: con el correo ana@clicksafe.mx,
  // "Manzana100" se rechazaba porque contiene "ana" — un falso positivo,
  // ya que "ana" (3 caracteres) no tiene relación real con el correo.
  it('acepta una contraseña que solo coincide por casualidad con un correo de parte local corta (< 4 caracteres)', () => {
    expect(() =>
      validatePasswordStrength('Manzana100', 'ana@clicksafe.mx', 'Cualquiera'),
    ).not.toThrow();
  });

  it('rechaza una contraseña que contiene una parte local de correo de 4+ caracteres', () => {
    expect(() =>
      validatePasswordStrength('migo2024', 'migo@example.com', 'Cualquiera'),
    ).toThrow(/correo/);
  });

  it('rechaza una contraseña que coincide con una palabra (>= 4 caracteres) del nombre completo', () => {
    // "ClickSafe" también está en la lista de comunes, así que se rechaza
    // de todas formas (esa regla se evalúa primero). El siguiente caso
    // aísla específicamente la regla de nombre con una contraseña que no
    // está en la lista de comunes.
    expect(() =>
      validatePasswordStrength('ClickSafe', 'otro@example.com', 'Click Safe'),
    ).toThrow(BadRequestException);
  });

  it('rechaza por nombre incluso cuando la contraseña no está en la lista de comunes', () => {
    // Aislado de la lista de contraseñas comunes (que sí incluye "clicksafe"):
    // confirma que el rechazo por nombre funciona independientemente de esa lista.
    expect(() =>
      validatePasswordStrength(
        'ClickMaster99',
        'otro@example.com',
        'Click Safe',
      ),
    ).toThrow(/nombre/);
  });

  it('no compara contra palabras del nombre menores a 4 caracteres', () => {
    expect(() =>
      validatePasswordStrength('Xk9#mPq2vL7zT4', 'otro@example.com', 'Ana Yu'),
    ).not.toThrow();
  });
});
