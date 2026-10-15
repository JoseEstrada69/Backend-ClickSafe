# Controles de seguridad ↔ ASVS 5.0

Tabla de trazabilidad para el reporte del curso *Integración de seguridad
informática en redes y sistemas de software* (Fase 7 de `CLAUDE.md`): cada
control implementado, el ataque concreto que previene, el requisito de
[OWASP ASVS 5.0](https://github.com/OWASP/ASVS/tree/master/5.0/en) que cubre
(verificado contra el repositorio oficial, no inventado) y el archivo donde
vive.

ASVS 5.0 reestructuró los capítulos respecto a la versión 4.x: la
autenticación es ahora **V6**, sesiones **V7**, autorización **V8**, tokens
autocontenidos (JWT) **V9**, validación y lógica de negocio **V2**,
criptografía **V11**, manejo de archivos **V5**, configuración **V13** y
logging/manejo de errores **V16**.

---

## 1. Autenticación y contraseñas

| Control | Ataque que previene | ASVS 5.0 | Archivo |
|---|---|---|---|
| Hash de contraseñas con Argon2id (memoryCost 19456, timeCost 2, parallelism 1) | Si la base se filtra, un atacante no puede recuperar las contraseñas en texto claro por fuerza bruta/diccionario a un costo razonable | 11.4.2 | `api/src/common/utils/password-hash.ts` |
| Longitud 8–128, sin reglas de composición forzadas, rechazo de contraseñas comunes (lista local de ~10 000) y que contengan el correo/nombre | Contraseñas débiles o predecibles (`Password123!`, el propio correo) que un diccionario dirigido adivina primero | 6.2.4, 6.2.5 | `api/src/auth/utils/password-strength.ts` |
| `argon2.verify` siempre se ejecuta, incluso contra un hash ficticio cuando el usuario no existe; nunca `===` para comparar secretos | Enumeración de usuarios midiendo el tiempo de respuesta del login, o bypass de comparación de contraseña con un truco de tipos | 11.2.4 | `api/src/auth/auth.service.ts` |
| Mensajes idénticos en login/registro/forgot-password exista o no la cuenta | Enumeración de usuarios por el contenido de la respuesta | 6.3.8 | `api/src/auth/auth.service.ts` |
| Bloqueo progresivo: 5 fallos → 15 min, duplicando hasta 24 h | Credential stuffing y fuerza bruta contra una cuenta específica | 6.3.1 | `api/src/auth/lockout.service.ts` |
| Captcha proof-of-work (ALTCHA) + anti-repetición (`Captcha_usado`) en registro/login/recuperación | Registro y login automatizados masivos (bots) | 2.4.1 | `api/src/captcha/captcha.service.ts` |
| Admin nuevo nace con contraseña aleatoria inutilizable (nadie la conoce) + código de recuperación de un solo uso | Que quien crea un admin (u otro admin) conozca o pueda imponer la contraseña del nuevo | 6.4.1 | `api/src/admin/admin.service.ts` (`createAdmin`) |

## 2. Segundo factor (TOTP) para admins

| Control | Ataque que previene | ASVS 5.0 | Archivo |
|---|---|---|---|
| Secreto TOTP cifrado con AES-256-GCM, nunca en claro en la base | Robo del secreto TOTP si la base se filtra, lo que permitiría generar códigos válidos indefinidamente | 11.3.2 | `api/src/auth/utils/totp-encryption.ts` |
| Ventana de tolerancia ±1 paso + rechazo de códigos con contador ≤ al último usado | Reutilizar un código TOTP interceptado (p. ej. por un keylogger u hombro-surfing) para iniciar sesión otra vez | 6.5.1, 6.5.5 | `api/src/auth/utils/totp.ts` |
| Reautenticación con el TOTP del propio admin que llama antes de crear otro admin o (en el futuro) acciones sensibles equivalentes | Que una sesión de admin robada (XSS, token filtrado) baste para crear admins nuevos sin volver a probar posesión del segundo factor | 7.5.1 | `api/src/auth/mfa.service.ts` (`reauthenticateAdmin`) |

## 3. Tokens y sesiones

| Control | Ataque que previene | ASVS 5.0 | Archivo |
|---|---|---|---|
| JWT firmado HS256, algoritmo fijado explícitamente al verificar (nunca `alg: none`), `iss`/`aud` validados | Ataque de confusión de algoritmo (forzar `alg:none` o cambiar a RS256 con la clave pública como secreto HMAC) | 9.1.2, 9.2.3 | `api/src/common/guards/jwt-auth.guard.ts` |
| Refresh token opaco (32 bytes aleatorios, nunca JWT); en BD solo se guarda su SHA-256 | Que robar la base de sesiones permita reconstruir refresh tokens válidos | 7.2.3 | `api/src/auth/session.service.ts` |
| Rotación de refresh token con detección de reuso (familia completa revocada si se reutiliza uno ya reemplazado) | Uso continuado de un refresh token robado: en cuanto el dueño legítimo lo usa de nuevo, toda la familia (incluido el del atacante) queda revocada | 7.4.1 | `api/src/auth/session.service.ts` |
| `JwtAuthGuard` revisa en cada petición que la sesión no esté revocada y el usuario siga activo (no solo la firma/expiración del JWT) | Seguir usando un access token válido (no expirado) después de un logout o de que un admin suspenda la cuenta | 8.3.2, 7.4.1 | `api/src/common/guards/jwt-auth.guard.ts` |
| Suspender un usuario revoca todas sus sesiones | Que una cuenta suspendida siga operando con sesiones ya abiertas hasta que expire el access token (15 min) | 7.4.2 | `api/src/admin/admin.service.ts` (`updateUserStatus`) |
| Cambiar/restablecer contraseña revoca las demás sesiones (no la actual) | Que alguien con una sesión robada en otro dispositivo siga activo después de que el dueño cambie su contraseña | 7.4.3 | `api/src/me/me.service.ts`, `api/src/auth/auth.service.ts` |

## 4. Autorización y control de propiedad (IDOR/BOLA)

| Control | Ataque que previene | ASVS 5.0 | Archivo |
|---|---|---|---|
| `RolesGuard`: rutas `@Roles('admin')` exigen rol admin **y** sesión con 2FA completado | Que una cuenta normal, o un admin que no ha completado 2FA, llame a endpoints administrativos | 8.2.1 | `api/src/common/guards/roles.guard.ts` |
| Control de propiedad en la misma consulta (editar/borrar reporte, borrar comentario, marcar notificación); 404 (no 403) si el recurso no existe o no es del usuario | IDOR/BOLA: editar o leer un recurso de otro usuario adivinando su id; un 403 además confirmaría que el recurso existe | 8.2.2 | `api/src/reports/reports.service.ts`, `api/src/comments/comments.service.ts`, `api/src/notifications/notifications.service.ts` |
| Operaciones condicionadas a estado hechas atómicas (`UPDATE ... WHERE id = ? AND id_usuario = ? AND estado = 'pendiente'`, o el `UPDATE` de moderación condicionado a "en moderación") | Condición de carrera (TOCTOU): el autor edita justo mientras un admin revisa, o dos admins moderan el mismo comentario a la vez | 2.3.3, 8.3.2 | `api/src/reports/reports.service.ts`, `api/src/admin/admin.service.ts` (`moderateComment`) |
| Un admin no puede revisar un reporte propio (separación de funciones) | Que un admin apruebe su propio reporte sin revisión independiente | 8.2.1 | `api/src/admin/admin.service.ts` (`reviewReport`) |
| `ValidationPipe` global `whitelist: true, forbidNonWhitelisted: true` | Mass assignment: mandar `"rol":"admin"` en el registro o `"estado":"validado"` al editar un reporte propio | 2.2.1, 8.2.3 | `api/src/setup-app.ts` |

## 5. Anonimato y exposición de datos

| Control | Ataque que previene | ASVS 5.0 | Archivo |
|---|---|---|---|
| Reportes/comentarios anónimos nunca devuelven nombre, correo ni id del autor en ninguna respuesta pública | Deanonimizar a quien reportó algo sensible (p. ej. a su propio empleador), con el riesgo de represalia que eso implica | 14.2.6 | `api/src/reports/reports.service.ts`, `api/src/comments/comments.service.ts` |
| `id_usuario` nunca se expone en respuestas públicas; no existe endpoint para ver el perfil de otro usuario | Correlacionar actividad entre reportes/comentarios para deanonimizar a un usuario, o enumerar perfiles ajenos | 14.2.6 | `api/src/reports/dto/report-response.dto.ts`, `api/src/me/` |
| `GET /admin/comments/flagged` expone `denuncias[]` (motivo, detalle, fecha) pero nunca quién denunció | Que el autor de un comentario moderado identifique y tome represalias contra quien lo denunció | 14.2.6 | `api/src/admin/admin.service.ts` (`listFlaggedComments`) |
| Las notificaciones de `comentario_ocultado`/`nuevo_comentario` nunca incluyen el nombre de quien comentó | Deanonimizar a un comentarista anónimo a través del propio sistema de notificaciones | 14.2.6 | `api/src/comments/comments.service.ts`, `api/src/admin/admin.service.ts` |

## 6. Validación de entradas e inyección

| Control | Ataque que previene | ASVS 5.0 | Archivo |
|---|---|---|---|
| Todo body/query/param con DTO de `class-validator` (longitudes, listas blancas, `trim`, rechazo de bytes de control) | Payloads malformados, campos fuera de rango, inyección de caracteres de control en logs/CSV | 2.2.1 | `api/src/**/dto/*.dto.ts` |
| `nombre` de Plataforma/Categoria_fraude con lista blanca de caracteres (`IsCatalogName`: letras con acentos/ñ/ü, dígitos, espacios, `. , & - ' ( )`) | Que un escaneo activo (confirmado con OWASP ZAP) use el campo `nombre` para guardar payloads de prueba (comillas, `chr(...)`, URLs, sintaxis SSTI) como si fueran catálogos válidos, ensuciando lo que ve la app iOS — ver sección 12 | 2.2.1 | `api/src/common/validators/catalog-name.validator.ts` |
| TypeORM `QueryBuilder` parametrizado en todas las consultas; nunca concatenación de strings | Inyección SQL | 1.2.4 | `api/src/reports/reports.service.ts`, `api/src/admin/admin.service.ts` |
| Búsqueda por texto (`q`) escapa `%`, `_` y `\` antes de armar el `LIKE` | Que el propio patrón de búsqueda del usuario se use para manipular el `LIKE` (p. ej. buscar `%` para forzar un escaneo completo, o inyectar comodines inesperados) | 1.2.4 | `api/src/common/utils/escape-like.ts` |
| Campos de ordenamiento (`orden`, `estado`) y de filtro cerrado (`accion` de la bitácora) elegidos de una lista blanca (enum/`@IsIn`), nunca pasados directo del query | Inyección SQL u ordenamiento arbitrario vía un parámetro que normalmente se concatenaría en un `ORDER BY`/`WHERE` | 2.2.1 | `api/src/reports/dto/report-query.dto.ts`, `api/src/admin/dto/audit-log-query.dto.ts` |
| Contenido de usuarios (títulos, descripciones, comentarios) se guarda tal cual y se devuelve como JSON; el cliente lo muestra como texto plano, nunca como HTML | XSS: un título o comentario con `<img src=x onerror=alert(1)>` nunca se ejecuta porque nunca se interpreta como HTML, en el cliente ni en el servidor | 1.2.1 | contrato de respuesta (sección 7 de `CLAUDE.md`); probado con `api/scripts/seed-demo.ts` |
| Paginación obligatoria (`page ≥ 1`, `limit` 1–50) en todo listado | Que una sola petición pida millones de filas y agote memoria/CPU del servidor (DoS) | 2.4.1 | `api/src/common/dto/pagination-query.dto.ts` |

## 7. URLs reportadas y SSRF

| Control | Ataque que previene | ASVS 5.0 | Archivo |
|---|---|---|---|
| `urlPublicacion` validada como URL http/https real, máx. 2048 caracteres, rechazando credenciales (`usuario:pass@host`) | Que un reporte use una URL con apariencia de un sitio legítimo para enmascarar un dominio real distinto (phishing/spoofing visual, como `mercadolibre.com.mx@estafa.example`) | 1.3.6 | `api/src/reports/dto/create-report.dto.ts` |
| El servidor **nunca** hace peticiones HTTP a una URL reportada (ni para previsualizarla, ni para validarla) | SSRF: si el servidor visitara URLs dadas por usuarios, un atacante reportaría `http://10.0.x.x/...` para escanear la red interna del backend | 1.3.6 | Invariante de diseño; no existe código que haga `fetch`/`axios` sobre `urlPublicacion` en ningún servicio |

## 8. Evidencias (subida de archivos)

| Control | Ataque que previene | ASVS 5.0 | Archivo |
|---|---|---|---|
| Formato real detectado con `sharp().metadata()` (nunca se confía en `Content-Type` ni en la extensión del cliente); solo jpeg/png/webp aceptados | Subir un ejecutable o script disfrazado de imagen cambiando la extensión/Content-Type | 5.2.2 | `api/src/evidences/image-processing.service.ts` |
| `limitInputPixels: 25_000_000` al leer con sharp | "Bomba de descompresión": una imagen de pocos KB que al decodificarse ocupa varios GB de RAM | 5.2.6 | `api/src/evidences/image-processing.service.ts` |
| Toda imagen se re-codifica a WebP sin copiar metadatos (nunca se llama a `.withMetadata()`) | Fuga de metadatos EXIF (incluida ubicación GPS) del usuario que sube la evidencia, y neutraliza contenido incrustado (polyglots) en el archivo original | 14.2.8 | `api/src/evidences/image-processing.service.ts` |
| Nombre de archivo generado (`uuid + .webp`), nunca el que manda el cliente; ruta final verificada dentro de `STORAGE_DIR` | Path traversal (`../../etc/passwd`) al construir la ruta de guardado con un nombre de archivo controlado por el atacante | 5.3.2 | `api/src/evidences/image-processing.service.ts`, `api/src/storage/disk-storage.service.ts` |
| URLs de evidencia firmadas con HMAC-SHA256 y expiración de 15 min | Acceso a evidencias por un enlace adivinado o permanente, filtrado fuera de su contexto original | 8.2.2 | `api/src/evidences/evidence-url.service.ts` |

## 9. Rate limiting, anti-automatización y recursos de infraestructura

| Control | Ataque que previene | ASVS 5.0 | Archivo |
|---|---|---|---|
| Límite global (100/min/IP) y por ruta (`/auth/*` 5/min, reportes 10/h, comentarios 30/h, denuncias 20/h) | Fuerza bruta de login/2FA, registro masivo, scraping agresivo del feed, espam de comentarios/denuncias | 2.4.1, 6.3.1 | `api/src/app.module.ts` (`ThrottlerModule`) |
| Límite "por usuario" usa el `sub` del token si hay sesión, IP si no | Que un usuario autenticado evada su propio límite cambiando de IP, o que el límite por IP golpee injustamente a varios usuarios detrás del mismo NAT | 2.4.1 | `api/src/app.module.ts` |
| `trust proxy` activado solo si `TRUST_PROXY=true` | Falsificar la IP de origen con el header `X-Forwarded-For` para evadir el rate limiting cuando la API no está realmente detrás de un proxy de confianza | 4.1.3 | `api/src/main.ts` |
| Tamaño del pool de conexiones MySQL explícito y configurable (`DB_POOL_SIZE`, antes el valor por defecto implícito del driver) | Contención de conexiones bajo carga concurrente alta (p. ej. un escaneo activo contra varias rutas a la vez) que podría degradar o interrumpir operaciones legítimas — ver sección 12 | 2.4.1 | `api/src/database/database.module.ts`, `api/src/config/env.schema.ts` |

## 10. Configuración, secretos y despliegue

| Control | Ataque que previene | ASVS 5.0 | Archivo |
|---|---|---|---|
| Variables de entorno validadas con zod al arrancar (secretos ≥ 32 bytes, nada hardcodeado) | Arrancar en producción con un secreto débil, faltante, o copiado de un ejemplo público | 13.3.1 | `api/src/config/env.schema.ts` |
| Secretos separados por propósito (`JWT_ACCESS_SECRET`, `JWT_MFA_SECRET`, `TOTP_ENCRYPTION_KEY`, etc.), nunca reutilizados | Que comprometer un secreto (p. ej. el de los JWT de sesión) comprometa también otro mecanismo no relacionado (TOTP, códigos de correo) | 13.3.1 | `api/.env.example` |
| La API se conecta como `clicksafe_api` (mínimo privilegio: sin `DELETE` en `Usuario`/`Comentario`/`Bitacora_auditoria`/`Plataforma`/`Categoria_fraude`, sin `UPDATE` en `Bitacora_auditoria`), nunca como root | Que una inyección SQL exitosa en cualquier capa pueda borrar usuarios, comentarios, catálogos, o alterar/borrar el rastro de auditoría | 13.2.2 | `database/clicksafe_db.sql` |
| Swagger (`/api/docs`) solo si `SWAGGER_ENABLED=true` | Exponer en producción un mapa completo de la API (rutas, esquemas, DTOs) a cualquiera que la visite | 13.4.5 | `api/src/setup-app.ts` |
| `helmet()` + `server_tokens off` en nginx | Fingerprinting de versión de servidor/framework para buscar vulnerabilidades conocidas | 13.4.6 | `api/src/main.ts`, `infra/nginx/clicksafe.conf` |
| TLS 1.2/1.3 únicamente, cifrados con forward secrecy preferidos, en el proxy nginx del laboratorio | Downgrade a TLS/cifrados viejos y vulnerables para interceptar el tráfico | 12.1.1 | `infra/nginx/clicksafe.conf` |
| Scripts de respaldo/restauración de solo desarrollo (`db:backup`/`db:restore`) bloqueados con `NODE_ENV=production`, sin imprimir la contraseña de MySQL | Ejecutar por error una restauración (que sobrescribe la base completa) contra un entorno de producción, o filtrar la contraseña de root en la salida de consola/logs | 13.3.1 | `api/scripts/db-backup.ts`, `api/scripts/db-restore.ts` |

## 11. Errores y auditoría

| Control | Ataque que previene | ASVS 5.0 | Archivo |
|---|---|---|---|
| Filtro global de excepciones: nunca stack traces ni mensajes crudos de MySQL/TypeORM; 500 → mensaje genérico, detalle solo en el log con `requestId` | Fuga de rutas internas del servidor, nombres de tablas/columnas, o la consulta SQL exacta que ayuda a un atacante a refinar una inyección | 16.5.1 | `api/src/common/filters/all-exceptions.filter.ts` |
| `nestjs-pino` con `redact` de `Authorization`, cookies, contraseñas, tokens y códigos | Que esos valores queden en texto plano en los logs y se filtren si alguien sin privilegio los lee (o si los logs se exfiltran) | 16.2.5 | `api/src/app.module.ts` |
| Bitácora de auditoría (login, 2fa_fallo, revisiones, moderación, suspensiones, etc.) con `detalle` nunca conteniendo secretos; cada evento guarda `ip`/`userAgent` cuando la ruta los captura (`@ClientInfo()`) | Falta de rastro forense ante un incidente; repudio de una acción administrativa; no poder correlacionar una acción con el origen de la petición | 16.3.1 | `api/src/audit/audit.service.ts`, `api/src/common/decorators/client-info.decorator.ts` |
| Un fallo al escribir en la bitácora se reintenta una vez y, si aun así falla, se registra en el log de la aplicación (nunca se pierde en silencio ni se revela al cliente); ese log de error incluye automáticamente el `req.id` de la petición (propagado por `nestjs-pino` vía `AsyncLocalStorage`, verificado forzando un fallo real — ver sección 12) | Que una falla transitoria (contención momentánea) descarte un evento de auditoría sin dejar ningún rastro, ni siquiera en el log de la aplicación, imposibilitando investigar un incidente después | 16.3.1 | `api/src/audit/audit.service.ts` |
| El usuario de BD de la API no tiene `UPDATE` ni `DELETE` sobre `Bitacora_auditoria` | Que un atacante que ya comprometió la API (p. ej. vía una inyección en otra parte) borre o altere el rastro de sus propias acciones | 16.4.2 | `database/clicksafe_db.sql` |
| Filtro `@Catch()` global como manejador de última instancia | Que una excepción no prevista tumbe el proceso completo (pérdida de disponibilidad) en vez de responder un error controlado | 16.5.4 | `api/src/common/filters/all-exceptions.filter.ts` |

## 12. Caso de estudio: bitácora de catálogos bajo un escaneo activo (antes/después)

Un escaneo activo de OWASP ZAP contra la API, con sesión de admin, dejó
cientos de filas de prueba en `Plataforma`/`Categoria_fraude` (sección 6) y,
al revisar `Bitacora_auditoria`, solo 3 eventos `catalogo_modificado`
quedaron registrados para todas esas creaciones/ediciones, los 3 con
`ip`/`user_agent` en `NULL`. Investigación y hallazgos:

- **Confirmado y corregido**: `createPlatform`/`updatePlatform`/
  `createCategory`/`updateCategory` nunca recibían `@ClientInfo()` en el
  controlador (a diferencia de `createAdmin`, que sí) — por eso esos 3
  eventos, y en realidad *todos* los eventos `catalogo_modificado` desde que
  existe esa funcionalidad, tenían `ip`/`userAgent` en `NULL` sin importar la
  carga. No era un problema de concurrencia. Se agregó `@ClientInfo()` a los
  4 endpoints (`api/src/admin/admin.controller.ts`) y se hilvanó hasta las 4
  llamadas a `AuditService.log` (`api/src/admin/admin.service.ts`). Cubierto
  por `api/test/audit-concurrency.e2e-spec.ts`.
- **Verificado, no es un bug**: el `req.id` (mismo valor que el header
  `X-Request-Id` de la respuesta al cliente) *ya* aparecía automáticamente en
  el log de error de `AuditService.log` antes de este cambio, sin tocar
  código — `nestjs-pino` lo propaga por una `AsyncLocalStorage` (ver
  `node_modules/nestjs-pino/dist/cjs/storage.js`) mientras la llamada ocurra
  dentro de la misma cadena async de la petición (como aquí, con `await`
  directo, sin `setTimeout`/callbacks sueltos). Se confirmó forzando un
  fallo real del `insert` dentro de una petición HTTP real: el log de error
  mostró el mismo `req.id` que el header de respuesta.
- **No se pudo reproducir la pérdida bajo carga con el código actual**: se
  intentó reproducir la pérdida masiva con (1) 150 llamadas concurrentes
  directas a `AdminService.createPlatform`, y (2) 100–300 peticiones HTTP
  reales concurrentes contra una instancia efímera completa (mismo stack de
  guards/interceptores que producción). En ambos casos, **0 eventos
  perdidos**. No se puede afirmar con certeza cuál fue el mecanismo exacto
  durante el escaneo real (posible contención de conexiones bajo un patrón
  de carga que no se logró replicar exactamente, p. ej. muchas rutas
  distintas a la vez durante varios minutos, no solo una).
- **Endurecido de todas formas** (sin esperar a reproducirlo, porque son
  mitigaciones razonables en sí mismas):
  - `DB_POOL_SIZE` (zod, default 20): antes el pool de conexiones mysql2 usaba
    el valor por defecto implícito del driver (10) sin que quedara
    documentado ni fuera ajustable sin tocar código.
  - `AuditService.log` reintenta una vez (75 ms de espera) antes de darse
    por vencido y recién ahí registrar el fallo en el log de la app; antes
    un solo fallo transitorio perdía el evento de inmediato.
- **Prueba de regresión**: `api/test/audit-concurrency.e2e-spec.ts` dispara
  50 creaciones de plataforma concurrentes y verifica que las 50 queden en
  `Bitacora_auditoria` con `ip` y `userAgent` no nulos.

---

*Verificado contra [OWASP/ASVS, rama `master`, carpeta `5.0/en`](https://github.com/OWASP/ASVS/tree/master/5.0/en) el 2026-10-14. Donde un control cubre la intención de un requisito sin que exista un número más específico (p. ej. SSRF o anonimato), se cita el requisito cuyo texto describe exactamente ese escenario, nunca un número inventado.*
