import type { Request } from 'express';
import type { Role } from '../decorators/roles.decorator';

/** Claims del access token (5.6 de CLAUDE.md). */
export interface JwtAccessPayload {
  sub: number;
  rol: Role;
  sid: string;
  mfa: boolean;
}

export interface AuthenticatedRequest extends Request {
  user?: JwtAccessPayload;
}
