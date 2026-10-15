/**
 * Lista cerrada de códigos de error estables (sección 7 de CLAUDE.md).
 * Agregar uno nuevo es una decisión deliberada: la app los traduce a
 * mensajes propios, así que un código suelto en cualquier parte del
 * código rompería ese contrato sin avisar.
 */
export type ErrorCode =
  | 'EMAIL_NOT_VERIFIED'
  | 'CAPTCHA_INVALID'
  | 'INVALID_CODE'
  | 'PASSWORD_WEAK'
  | 'REPORT_NOT_EDITABLE'
  | 'EVIDENCE_LIMIT'
  | 'INVALID_IMAGE'
  | 'OWN_REPORT'
  | 'OWN_COMMENT'
  | 'ALREADY_FLAGGED'
  | 'CATALOG_INACTIVE'
  | 'PLATFORM_OTHER_REQUIRED'
  | 'INVALID_CURRENT_PASSWORD'
  // Solo del panel de admin (la app iOS es solo para usuarios, sección 7):
  // ningún cliente iOS necesita traducir estos 6.
  | 'INVALID_TOTP'
  | 'OWN_STATUS'
  | 'LAST_ACTIVE_ADMIN'
  | 'EMAIL_TAKEN'
  | 'COMMENT_NOT_FLAGGED'
  | 'CATALOG_NAME_TAKEN';

/** Cuerpo de respuesta que acepta HttpException para llevar un `code` estable. */
export interface CodedErrorBody {
  message: string;
  code: ErrorCode;
}
