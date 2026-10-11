/**
 * Nombre del esquema de seguridad "Authorize" de Swagger. Se usa tanto en
 * `DocumentBuilder().addBearerAuth(..., NAME)` (setup-app.ts) como en cada
 * `@ApiBearerAuth(NAME)` de los controladores: una sola constante evita que
 * ambos lados queden con nombres distintos (si no coinciden, Swagger UI deja
 * de mandar el header Authorization aunque hayas hecho "Authorize").
 */
export const BEARER_AUTH_SCHEME_NAME = 'access-token';

/**
 * Esquema separado para el mfaToken (5.4/5.5): /auth/2fa/setup y
 * /auth/2fa/enable aceptan un mfaToken (recién emitido en login, sin
 * sesión todavía) O el access token de una sesión admin ya completada
 * (para reconfigurar 2FA más adelante). Un solo esquema "access-token" no
 * deja autorizarte en Swagger con el mfaToken por separado; con dos
 * esquemas, Swagger UI permite elegir cuál mandar y el candado sí manda el
 * header en ambos casos.
 */
export const MFA_TOKEN_SCHEME_NAME = 'mfa-token';
