import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marca una ruta como accesible sin token. Por defecto (deny-by-default),
 * JwtAuthGuard exige token en toda ruta; esto es la única forma de saltarlo.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
