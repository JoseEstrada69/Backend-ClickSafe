/** GET /auth/captcha (5.2): reto proof-of-work estilo ALTCHA. */
export class CaptchaChallengeResponse {
  algorithm!: 'SHA-256';
  challenge!: string;
  maxnumber!: number;
  salt!: string;
  signature!: string;
}
