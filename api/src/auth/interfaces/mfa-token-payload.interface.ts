/** Claims del mfaToken (5.4/5.5): nunca lleva `rol`, solo identifica al admin que todavía no completó 2FA. */
export interface MfaTokenPayload {
  sub: number;
  typ: 'mfa';
}
