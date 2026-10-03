import { BadRequestException } from '@nestjs/common';
import { isCommonPassword } from './common-passwords';

/**
 * Valida una contraseña nueva (5.1): longitud 8–128, no estar en la lista
 * de comunes, no contener el correo ni el nombre del usuario. ASVS ya no
 * recomienda reglas de composición forzada (mayúsculas/símbolos/etc.), así
 * que no se piden aquí.
 */
export function validatePasswordStrength(
  password: string,
  correo: string,
  nombre: string,
): void {
  if (password.length < 8 || password.length > 128) {
    throw new BadRequestException({
      message: 'La contraseña debe tener entre 8 y 128 caracteres.',
      code: 'PASSWORD_WEAK',
    });
  }

  if (isCommonPassword(password)) {
    throw new BadRequestException({
      message: 'Esa contraseña es demasiado común. Elige otra.',
      code: 'PASSWORD_WEAK',
    });
  }

  const lowerPassword = password.toLowerCase();

  const localPart = correo.split('@')[0]?.toLowerCase() ?? '';
  if (localPart.length >= 3 && lowerPassword.includes(localPart)) {
    throw new BadRequestException({
      message: 'La contraseña no puede contener tu correo.',
      code: 'PASSWORD_WEAK',
    });
  }

  const nombreNormalizado = nombre.trim().toLowerCase();
  if (
    nombreNormalizado.length >= 3 &&
    lowerPassword.includes(nombreNormalizado)
  ) {
    throw new BadRequestException({
      message: 'La contraseña no puede contener tu nombre.',
      code: 'PASSWORD_WEAK',
    });
  }
}
