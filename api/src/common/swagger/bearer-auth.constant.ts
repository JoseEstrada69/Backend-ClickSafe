/**
 * Nombre del esquema de seguridad "Authorize" de Swagger. Se usa tanto en
 * `DocumentBuilder().addBearerAuth(..., NAME)` (setup-app.ts) como en cada
 * `@ApiBearerAuth(NAME)` de los controladores: una sola constante evita que
 * ambos lados queden con nombres distintos (si no coinciden, Swagger UI deja
 * de mandar el header Authorization aunque hayas hecho "Authorize").
 */
export const BEARER_AUTH_SCHEME_NAME = 'access-token';
