export interface TokensResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface MfaChallengeResponse {
  mfaRequired?: true;
  mfaSetupRequired?: true;
  mfaToken: string;
}

export interface GenericMessageResponse {
  message: string;
}

export interface Setup2faResponse {
  otpauthUri: string;
  qrCodeDataUrl: string;
}
