import { BadRequestException } from '@nestjs/common';
import { isCommonPassword } from './common-passwords';

/**
 * Umbral mínimo para considerar una coincidencia real. Con 3 (el valor
 * original) correos cortos como "ana@..." rechazaban contraseñas que
 * solo contenían esas 3 letras por coincidencia (p. ej. "Manzana100"
 * contiene "ana" sin que tenga nada que ver con el correo) — un falso
 * positivo que bloqueaba contraseñas fuertes y legítimas.
 */
const MIN_MATCH_LENGTH = 4;

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
  if (
    localPart.length >= MIN_MATCH_LENGTH &&
    lowerPassword.includes(localPart)
  ) {
    throw new BadRequestException({
      message: 'La contraseña no puede contener tu correo.',
      code: 'PASSWORD_WEAK',
    });
  }

  // Por palabra, no el nombre completo: así "Click Safe" rechaza
  // "ClickSafe" (contiene la palabra "click") aunque el nombre completo
  // con espacio nunca aparezca literal dentro de la contraseña.
  const palabrasDelNombre = nombre
    .toLowerCase()
    .split(/\s+/)
    .filter((palabra) => palabra.length >= MIN_MATCH_LENGTH);
  if (palabrasDelNombre.some((palabra) => lowerPassword.includes(palabra))) {
    throw new BadRequestException({
      message: 'La contraseña no puede contener tu nombre.',
      code: 'PASSWORD_WEAK',
    });
  }
}
