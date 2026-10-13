export class TokensResponse {
  accessToken!: string;
  refreshToken!: string;
  expiresIn!: number;
}

export class MfaChallengeResponse {
  mfaRequired?: true;
  mfaSetupRequired?: true;
  mfaToken!: string;
}

export class GenericMessageResponse {
  message!: string;
}

export class Setup2faResponse {
  otpauthUri!: string;
  qrCodeDataUrl!: string;
}
