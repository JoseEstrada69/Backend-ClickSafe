import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

export type Role = 'usuario' | 'admin';

/**
 * Restringe una ruta a uno o más roles. RolesGuard además exige que rutas
 * de admin tengan la sesión completada con 2FA (claim `mfa: true`).
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
