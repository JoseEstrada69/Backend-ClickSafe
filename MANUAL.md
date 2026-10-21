# Manual de ClickSafe — Backend

> Documentación de referencia del backend de ClickSafe: qué es el proyecto,
> las reglas de negocio, las decisiones técnicas, la arquitectura de
> seguridad y el contrato de la API. Para cómo está organizado el trabajo
> con el asistente de IA en este repositorio, ver [CLAUDE.md](CLAUDE.md).

---

## 1. Qué es ClickSafe

App iOS (SwiftUI) tipo red social para **reportar publicaciones sospechosas
de fraude en tiendas en línea**. Socio formador: Red por la Ciberseguridad
(ONG mexicana de ciberseguridad y derechos digitales). Este repositorio
contiene la **API REST en NestJS** que usa la app, y más adelante
contendrá también el **sitio web de administrador**.

Proyecto de la materia *Integración de seguridad informática en redes y
sistemas de software* (Tec de Monterrey). El requisito del curso es
cumplir **OWASP ASVS nivel 2**: la seguridad es la prioridad número uno, y
el proyecto se evalúa con pruebas de penetración (nmap, Nessus, OWASP ZAP
contra la API y el sitio de admin) y análisis de código estático.

### Roles

- `usuario`: se registra, crea reportes, da like, comenta, denuncia comentarios.
- `admin`: todo lo anterior + valida/rechaza reportes, modera comentarios,
  suspende usuarios, crea otros admins, administra catálogos, ve estadísticas
  y bitácora. **2FA (TOTP) obligatorio para admins.**
- No hay más roles. El primer admin se crea con un script de seed; los demás
  los crea un admin desde la API. **Nunca** hay forma pública de volverse admin.

### Reglas de negocio (fuente de verdad)

1. **Reportes**: título, descripción, URL de la publicación, plataforma,
   categoría de fraude, imágenes de evidencia (opcional), anónimo sí/no.
   - Estados: `pendiente` → `validado` | `rechazado`. Solo un admin cambia el estado.
   - Son **públicos desde que se crean** (para usuarios autenticados).
   - El autor puede **editar o borrar** su reporte **solo mientras esté `pendiente`**.
     Una vez revisado, nadie (ni el autor) lo modifica.
   - Si la plataforma no está en el catálogo se elige la plataforma `Otra`
     (`es_otra = TRUE`) y el usuario escribe el nombre en `plataforma_otra`
     (obligatorio en ese caso, prohibido en cualquier otro).
2. **Anonimato**: si un reporte o comentario es anónimo, la API **no devuelve
   ningún dato del autor** (ni nombre, ni id, ni nada que permita
   correlacionarlo). Solo el propio autor ve que es suyo (`esMio: true`).
3. **Perfiles**: nadie puede ver el perfil de otro usuario. Cada usuario ve
   solo su propio perfil con su historial de reportes y comentarios.
   **Los `id_usuario` nunca se exponen en respuestas públicas.**
4. **Likes**: dan visibilidad a un reporte (el feed se puede ordenar por likes).
   Un like por usuario por reporte. No se puede dar like al propio reporte.
5. **Comentarios**: se pueden publicar en modo anónimo. El autor puede
   **borrarlos pero no editarlos**. Borrar = borrado lógico (`estado = 'eliminado'`).
6. **Denuncias de comentarios (moderación híbrida)**: cualquier usuario puede
   denunciar un comentario ajeno una sola vez. Al llegar a **3 denuncias no
   resueltas de usuarios distintos**, el comentario pasa automáticamente a
   `oculto_auto` y entra a la cola del admin, que lo **confirma**
   (`oculto_admin`) o lo **restaura** (`visible`). Al resolver, las denuncias
   se marcan `resuelta = TRUE` y `total_denuncias` vuelve a 0.
7. **Revisión de reportes**: un admin valida o rechaza un reporte `pendiente`
   con un comentario opcional. Se crea un registro en `Revision_reporte` y una
   notificación al autor. **Un admin no puede revisar un reporte propio**
   (separación de funciones).
8. **Evidencias**: solo imágenes (JPEG, PNG, WebP), máx. 5 MB cada una, máx.
   5 por reporte. Son públicas. La app muestra al usuario una advertencia de
   no subir datos personales.
9. **Notificaciones**: solo dentro de la app (no push). Tipos:
   `reporte_validado`, `reporte_rechazado`, `nuevo_comentario` (al autor del
   reporte, si el comentario no es suyo), `comentario_ocultado` (al autor del
   comentario). **Los mensajes nunca incluyen el nombre de quien comentó.**
10. **Catálogos** (`Plataforma`, `Categoria_fraude`): los administra solo el
    admin. No se borran, se desactivan (`activa = FALSE`). Los desactivados
    no aparecen al crear reportes, pero los reportes viejos los conservan.
    La plataforma `Otra` nunca se puede desactivar ni modificar vía API.
11. **Dashboard admin**: estadísticas de reportes por plataforma (todas las
    de `es_otra` agrupadas como "Otra"), por categoría y por estado.
12. **Correo**: no se usan servicios externos. En desarrollo se usa
    **Mailpit** (servidor SMTP local que atrapa los correos y los muestra en
    una interfaz web en `http://localhost:8025`). En la topología de red es
    un nodo "servidor de correo".
13. **Captcha**: proof-of-work (protocolo ALTCHA), sin servicios externos.

---

## 2. Stack y decisiones técnicas

| Tema | Decisión |
|---|---|
| Runtime | Node.js LTS (mínimo 22, recomendado 24) |
| Framework | NestJS con TypeScript en modo `strict` |
| Gestor de paquetes | npm (se commitea `package-lock.json`) |
| BD | MySQL 8.0.16+ — esquema en `database/clicksafe_db.sql` |
| ORM | TypeORM con `synchronize: false` y `migrationsRun: false` |
| Hash de contraseñas | `argon2` (Argon2id: memoryCost 19456, timeCost 2, parallelism 1 — mínimo recomendado por OWASP) |
| JWT | `@nestjs/jwt`, HS256, algoritmo fijado explícitamente al verificar |
| Validación | `class-validator` + `class-transformer` |
| Rate limiting | `@nestjs/throttler` |
| Headers | `helmet` |
| Configuración | `@nestjs/config` + validación del `.env` con `zod` |
| Logs | `nestjs-pino` con redacción de campos sensibles |
| Imágenes | `multer` (memoria) + `sharp` |
| TOTP | `otplib` (+ `qrcode` para el QR de configuración) |
| Captcha | Protocolo ALTCHA implementado con `node:crypto` (reto = SHA-256(salt + número), firma = HMAC-SHA256) |
| Correo | `nodemailer` apuntando a Mailpit |
| Docs API | `@nestjs/swagger` (OpenAPI) |
| Tests | Jest + `supertest` para e2e |

### La base de datos es la fuente de verdad

- El esquema vive en `database/clicksafe_db.sql`. Las entidades de TypeORM
  lo reflejan exactamente (mismos nombres de tabla y columna, tipos,
  nullabilidad, longitudes): `@Entity('Reporte')`, `@Column({ name:
  'fecha_creacion' })`, etc. Nunca se usa `synchronize: true` ni
  migraciones que alteren el esquema — un cambio de esquema se hace
  primero en el `.sql`.
- Conexión con `timezone: 'Z'` (todas las fechas en UTC).
- La API se conecta con el usuario de BD **`clicksafe_api`** (mínimo
  privilegio, ver sección 6 del `.sql`), **nunca con root**. Ese usuario no
  tiene `DELETE` sobre `Usuario`, `Comentario` ni `Bitacora_auditoria`, ni
  `UPDATE` sobre `Bitacora_auditoria`.

---

## 3. Estructura del repositorio

```
/
├── MANUAL.md                 ← este archivo
├── CLAUDE.md                 ← instrucciones de trabajo con el asistente de IA
├── README.md                 ← cómo levantar el proyecto (en español)
├── .gitignore  .gitattributes  .editorconfig
├── database/
│   └── clicksafe_db.sql      ← esquema + catálogos + usuario de mínimo privilegio
├── infra/
│   └── docker-compose.yml    ← OPCIONAL: MySQL 8 + Mailpit para desarrollo
├── docs/
│   ├── openapi.json          ← exportado con `npm run openapi:export`
│   ├── seguridad.md          ← controles de seguridad ↔ requisitos ASVS
│   └── despliegue.md         ← despliegue en el laboratorio de dos PCs
├── api/                      ← proyecto NestJS
│   ├── src/
│   │   ├── main.ts
│   │   ├── app.module.ts
│   │   ├── config/           ← esquema zod del .env y config tipada
│   │   ├── common/           ← guards, decorators, filters, interceptors, pipes, utils
│   │   ├── database/         ← módulo TypeORM y entidades
│   │   ├── audit/            ← servicio de bitácora
│   │   ├── mail/              ← servicio de correo (Mailpit)
│   │   ├── storage/           ← StorageService (interfaz) + implementación en disco
│   │   ├── captcha/
│   │   ├── auth/
│   │   ├── me/
│   │   ├── catalogs/         ← plataformas y categorías (lectura)
│   │   ├── reports/          ← reportes, evidencias, likes
│   │   ├── comments/         ← comentarios y denuncias
│   │   ├── notifications/
│   │   └── admin/
│   ├── scripts/              ← seed-admin.ts, seed-demo.ts, export-openapi.ts, etc.
│   ├── test/                 ← e2e
│   ├── .env.example
│   └── package.json
└── admin-web/                ← (fase posterior) sitio web del administrador
```

`.gitattributes` fija `* text=auto eol=lf` (el equipo mezcla Windows y Mac).
`.gitignore` excluye `node_modules/`, `dist/`, `coverage/`, `.env`,
`.env.*` (excepto los `.env.*.example`), la carpeta de almacenamiento de
archivos subidos, `*.pem`, `*.key`, `*.crt`.

---

## 4. Seguridad transversal (aplica a toda la API)

### 4.1 Arranque (`main.ts`)

- Prefijo global `/api/v1`.
- `helmet()` con su configuración por defecto (la API solo devuelve JSON e imágenes).
- CORS **deshabilitado** por defecto (la app iOS no lo necesita y el sitio de
  admin se sirve en el mismo origen detrás de Nginx). Se habilita solo si
  `CORS_ORIGINS` tiene valores, y solo para esos orígenes exactos.
- Límite de tamaño del body JSON: `100kb`.
- `trust proxy` activado **solo si** `TRUST_PROXY=true` (cuando está detrás de
  Nginx). Si se activara sin proxy, un atacante podría falsificar su IP con
  el header `X-Forwarded-For` y evadir el rate limiting.
- `ValidationPipe` global con `whitelist: true, forbidNonWhitelisted: true,
  transform: true`. Esto previene **mass assignment**: si alguien manda
  `"rol": "admin"` o `"estado": "validado"` en un body, la petición se
  rechaza.
- Swagger en `/api/docs` **solo si** `SWAGGER_ENABLED=true` (en producción
  exponer la documentación da un mapa gratis al atacante).

### 4.2 Configuración

- Todas las variables de entorno se validan con zod al arrancar. Si falta
  una o no cumple el formato (p. ej. un secreto de menos de 32 bytes), la
  API no inicia y muestra qué falta (sin mostrar valores).
- Secretos separados (una clave por propósito, nunca reutilizada):
  `JWT_ACCESS_SECRET`, `JWT_MFA_SECRET`, `TOTP_ENCRYPTION_KEY` (32 bytes,
  AES-256-GCM), `CODE_HMAC_KEY` (códigos de correo), `CAPTCHA_HMAC_KEY`,
  `EVIDENCE_URL_SECRET` (URLs firmadas), `DB_PASSWORD`.

### 4.3 Autorización: denegación por defecto

- Guards globales, en orden: `ThrottlerGuard` → `JwtAuthGuard` (toda ruta
  requiere token salvo las marcadas `@Public()`) → `RolesGuard` (rutas con
  `@Roles('admin')` requieren rol admin **y** sesión completada con 2FA).
- `JwtAuthGuard`, además de verificar firma y expiración, consulta que la
  sesión (`sid` del token) no esté revocada y que el usuario siga `activo`.
  Así un logout o una suspensión surten efecto de inmediato y no hasta que
  expire el token.
- **Control de propiedad (anti-BOLA/IDOR)**: toda operación sobre un recurso
  de un usuario (editar/borrar reporte, borrar comentario, marcar
  notificación, etc.) filtra **en la misma consulta** por el id del usuario
  autenticado. Si el recurso no existe **o no es del usuario**, la API
  responde **404** (no 403) para no revelar que existe.
- Las operaciones condicionadas a un estado son **atómicas**:
  `UPDATE Reporte SET ... WHERE id_reporte = ? AND id_usuario = ? AND estado = 'pendiente'`,
  revisando las filas afectadas. Esto previene una condición de carrera
  (TOCTOU) en la que el autor edita justo mientras un admin lo valida.

### 4.4 Rate limiting

- Global: 100 peticiones / minuto por IP.
- Rutas de `/auth/*`: 5 / minuto por IP (login, registro, recuperación, verificación).
- Creación de reportes: 10 / hora por usuario. Comentarios: 30 / hora. Denuncias: 20 / hora.
- Los límites "por usuario" usan un `getTracker` que toma el `sub` del
  token (si no hay token, la IP).
- Todos los límites se leen del `.env` (con estos valores por defecto),
  para poder ajustarlos sin tocar código.
- Respuesta 429 genérica.

### 4.5 Errores y logs

- Filtro global de excepciones: la respuesta nunca incluye stack traces,
  mensajes de MySQL/TypeORM ni rutas del servidor. Formato:
  `{ "statusCode": 400, "error": "Bad Request", "message": "...", "requestId": "..." }`.
  Errores 500 devuelven un mensaje genérico; el detalle solo va al log,
  correlacionado por el `requestId`.
- Violaciones de constraints de MySQL (duplicados, CHECK, FK) se traducen a
  409/400 con mensaje genérico.
- `nestjs-pino` redacta: `req.headers.authorization`, `req.headers.cookie`,
  y cualquier campo `password`, `passwordActual`, `nuevaPassword`, `token`,
  `refreshToken`, `codigo`, `totp`.
- Cada petición lleva un `requestId` (UUID), devuelto en el header `X-Request-Id`.

### 4.6 Bitácora de auditoría (`Bitacora_auditoria`)

`AuditService.log({ idUsuario, accion, resultado, recursoTipo, recursoId, ip, userAgent, detalle })`.
Se registra como mínimo: `login` (éxito/fallo), `cuenta_bloqueada`, `logout`,
`refresh_reuso_detectado`, `registro`, `correo_verificado`,
`password_recuperacion_solicitada`, `password_cambiada`, `2fa_activado`,
`2fa_fallo`, `reporte_revisado`, `comentario_moderado`, `usuario_suspendido`,
`usuario_reactivado`, `admin_creado`, `catalogo_modificado`,
`password_cambio_fallo`. `detalle` nunca contiene contraseñas, tokens,
códigos ni secretos. Si falla escribir la bitácora, se registra en el log
de la app pero no se revela al cliente.

### 4.7 Validación de entradas

- Todo body, query y param tiene un DTO con `class-validator`. Ids de ruta con
  `ParseIntPipe` (y rango > 0).
- Longitudes máximas iguales a las del esquema SQL.
- Strings: `trim`, y se rechazan caracteres de control (excepto `\n` en
  descripciones/comentarios) y bytes nulos.
- El contenido de usuarios (títulos, descripciones, comentarios) se guarda
  tal cual y se devuelve como JSON; el cliente lo muestra como texto plano,
  nunca como HTML — eso previene XSS sin necesidad de sanitizar el texto.
- Paginación en todo listado: `page` ≥ 1, `limit` entre 1 y 50 (default 20).
- Toda consulta usa parámetros del ORM / QueryBuilder (prohibido concatenar
  strings en SQL). Los campos de ordenamiento se eligen de una lista
  blanca (enum), nunca se pasan directo desde el query.

### 4.8 URLs reportadas (riesgo específico de ClickSafe)

- `@IsUrl({ protocols: ['http','https'], require_protocol: true, require_tld: true })`,
  máximo 2048 caracteres, se rechazan URLs con credenciales (`usuario:pass@host`).
- **El servidor nunca hace peticiones a la URL reportada** (ni para vista
  previa, ni para validarla). Esto previene SSRF: si el servidor visitara
  URLs dadas por usuarios, un atacante podría reportar `http://10.0.x.x/...`
  para explorar la red interna.

---

## 5. Autenticación (detalle)

### 5.1 Contraseñas (ASVS v5, cap. 6)

- Longitud mínima 8, máxima 128. Sin reglas de composición forzadas; en su
  lugar, se rechazan contraseñas de una lista local de contraseñas comunes
  (sin consultar servicios externos) y contraseñas que contengan el correo
  o el nombre.
- Argon2id. Las contraseñas nunca se comparan con `===`.

### 5.2 Captcha proof-of-work

- `GET /auth/captcha` (público) devuelve un reto ALTCHA que expira en 5 min.
- Obligatorio en: registro, login, reenviar código, olvidé contraseña,
  restablecer contraseña. Se manda en el body como `captcha` (payload en base64).
- Al verificar: se comprueba la firma HMAC, la expiración y que la firma no
  esté en `Captcha_usado`; luego se inserta (previene reutilizar un captcha
  resuelto). Una tarea programada borra los expirados.

### 5.3 Registro y verificación de correo

- `POST /auth/register {nombre, correo, password, captcha}`.
- El correo se normaliza (trim + minúsculas).
- **Respuesta idéntica** exista o no el correo:
  `202 { message: "Si el correo es válido, recibirás un código de verificación." }`.
  Si ya existía, en vez del código se le manda al dueño un correo avisando
  que alguien intentó registrarse con su dirección. Esto previene
  **enumeración de usuarios**.
- Se envía un código numérico de 6 dígitos (`crypto.randomInt`), válido 30
  min, máx. 5 intentos. Se guarda en `Token_verificacion` como
  `HMAC-SHA256(CODE_HMAC_KEY, id_usuario:tipo:codigo)` en hex. Un código
  nuevo invalida los anteriores del mismo tipo.
- `POST /auth/verify-email {correo, codigo}` marca `correo_verificado`.
  Respuesta genérica en error; las comparaciones de hash usan
  `crypto.timingSafeEqual`.
- `POST /auth/resend-verification {correo, captcha}` responde de forma genérica.
- No se puede iniciar sesión sin correo verificado.

### 5.4 Login

- `POST /auth/login {correo, password, captcha}`.
- Si el usuario no existe, igual se ejecuta `argon2.verify` contra un hash
  ficticio para que el tiempo de respuesta sea el mismo (evita enumerar
  usuarios midiendo tiempos).
- Mensaje de error siempre: `"Credenciales inválidas"`.
- **Bloqueo progresivo**: 5 fallos consecutivos → bloqueo 15 min; cada
  bloqueo siguiente duplica el tiempo (máx. 24 h). Login exitoso o
  restablecer contraseña reinician el contador. Durante el bloqueo se
  responde lo mismo que credenciales inválidas (y se audita).
- Usuario `activo = FALSE` → mismo mensaje genérico.
- Correo no verificado (con contraseña correcta) → 403 con
  `code: "EMAIL_NOT_VERIFIED"`.
- **Usuario normal** → devuelve `{ accessToken, refreshToken, expiresIn }`.
- **Admin** → no devuelve tokens de sesión. Devuelve un `mfaToken`
  (JWT firmado con `JWT_MFA_SECRET`, `typ: "mfa"`, 5 min) y:
  - si ya tiene 2FA activo: `{ mfaRequired: true, mfaToken }`
  - si aún no lo configura: `{ mfaSetupRequired: true, mfaToken }`

### 5.5 2FA para admins (TOTP)

- `POST /auth/2fa/setup` genera el secreto, lo guarda **cifrado con
  AES-256-GCM** (`iv:tag:cifrado` en base64, clave `TOTP_ENCRYPTION_KEY`) y
  devuelve el URI `otpauth://` y un QR en data-URL.
- `POST /auth/2fa/enable {codigo}` verifica el primer código y activa.
- `POST /auth/2fa/verify {mfaToken, codigo}` emite la sesión completa con
  claim `mfa: true` si el código es correcto.
- Ventana de tolerancia ±1 paso (30 s). Se guarda el contador usado en
  `totp_ultimo_contador` y se rechazan códigos con contador ≤ al último
  usado (un código TOTP solo se puede usar una vez).
- 5 códigos fallidos aplican el mismo bloqueo del login.

### 5.6 Tokens y sesiones

- **Access token**: JWT HS256, 15 min. Claims: `sub` (id usuario), `rol`,
  `sid` (id de sesión), `mfa` (bool). Al verificar, se fija
  `algorithms: ['HS256']` (previene confusión de algoritmo / `alg: none`),
  y se valida `iss`/`aud`.
- **Refresh token**: 32 bytes aleatorios (`crypto.randomBytes`) en
  base64url, no es JWT. En BD solo se guarda su SHA-256 (`Sesion.token_hash`).
  Vida: 7 días deslizantes, 30 días absolutos (`expira_absoluta`).
- **Rotación con detección de reuso** (`POST /auth/refresh`): cada uso
  marca la fila con `reemplazada_en` y crea una nueva de la misma
  `familia`. Si llega un token ya reemplazado, se revoca toda la familia,
  se audita `refresh_reuso_detectado` y se responde 401.
- `POST /auth/logout` revoca la sesión actual; `POST /auth/logout-all`
  revoca todas las del usuario.
- Cambiar contraseña, restablecerla o suspender un usuario revoca todas sus
  sesiones.
- La app iOS guarda los tokens en el Keychain.

### 5.7 Recuperación de contraseña

- `POST /auth/forgot-password {correo, captcha}` responde siempre de forma
  genérica. Si el correo existe y está activo, se envía un código de 8
  dígitos, válido 15 min, máx. 5 intentos.
- `POST /auth/reset-password {correo, codigo, nuevaPassword, captcha}`
  cambia la contraseña, marca el código usado, reinicia el bloqueo, revoca
  todas las sesiones, audita y envía un correo avisando del cambio.

---

## 6. Evidencias (subida de archivos)

1. `multer` con `memoryStorage`, `limits: { fileSize: 5 MB, files: 5 }`.
2. Se ignoran el nombre del archivo y el `Content-Type` que manda el
   cliente (ambos los controla quien hace la petición).
3. El formato real se detecta con
   `sharp(buffer, { limitInputPixels: 25_000_000 }).metadata()`. Solo se
   aceptan `jpeg`, `png`, `webp`. El límite de píxeles previene las
   "bombas de descompresión" (una imagen de pocos KB que al abrirse ocupa GB de RAM).
4. La imagen se re-codifica siempre: redimensionada a máx. 2048 px por
   lado y guardada como WebP (calidad ~80). Sharp no copia metadatos por
   defecto (nunca se llama a `.withMetadata()`), lo que elimina el EXIF
   (incluida la ubicación GPS) y destruye cualquier contenido incrustado
   (polyglots).
5. Nombre = `uuid v4 + .webp`. Ruta relativa `evidencias/AAAA/MM/<uuid>.webp`
   dentro de `STORAGE_DIR` (fuera de la carpeta del código). Al resolver la
   ruta absoluta se verifica que siga dentro de `STORAGE_DIR` (previene
   path traversal).
6. Se guarda en `Evidencia` el tamaño final y el SHA-256 del archivo final.
7. `StorageService` es una interfaz (`save`, `read`, `delete`) con una
   implementación en disco.
8. **Las imágenes se sirven con URL firmada**: cada evidencia trae una URL
   `/api/v1/evidences/:id?exp=<unix>&sig=<HMAC>` válida 15 min
   (`HMAC-SHA256(EVIDENCE_URL_SECRET, id:exp)`). Esa ruta es pública pero
   solo responde si la firma es válida y no ha expirado. Headers de
   respuesta: `Content-Type: image/webp`, `X-Content-Type-Options:
   nosniff`, `Content-Security-Policy: default-src 'none'`,
   `Cache-Control: private, max-age=900`.
9. Si falla cualquier paso después de guardar el archivo, se borra (no
   quedan huérfanos). Al borrar un reporte, se borran sus archivos.

---

## 7. Endpoints

Todos bajo `/api/v1`. 🔓 = público. 👑 = admin + 2FA. El resto requiere
usuario autenticado. Todas las respuestas están documentadas en Swagger
con sus DTOs.

**Contrato común**:

- JSON de respuesta en **camelCase** (`urlPublicacion`, `totalLikes`, `fechaCreacion`).
- Fechas en ISO 8601 UTC con `Z` (`2026-09-26T18:30:00.000Z`).
- Listados paginados: `{ "items": [...], "page": 1, "limit": 20, "total": 134 }`.
- Errores en el formato de la sección 4.5. Cuando la app necesita distinguir
  un caso, se agrega un campo `code` estable (lista cerrada): `EMAIL_NOT_VERIFIED`,
  `CAPTCHA_INVALID`, `INVALID_CODE`, `PASSWORD_WEAK`, `REPORT_NOT_EDITABLE`,
  `EVIDENCE_LIMIT`, `INVALID_IMAGE`, `OWN_REPORT`, `OWN_COMMENT`,
  `ALREADY_FLAGGED`, `CATALOG_INACTIVE`, `PLATFORM_OTHER_REQUIRED`,
  `INVALID_CURRENT_PASSWORD`. Solo del panel de admin: `INVALID_TOTP`,
  `OWN_STATUS`, `LAST_ACTIVE_ADMIN`, `EMAIL_TAKEN`, `COMMENT_NOT_FLAGGED`,
  `CATALOG_NAME_TAKEN`.
- La app iOS es solo para usuarios (`rol = 'usuario'`). Los admins usan el
  sitio web; si un admin inicia sesión en la app, recibe `mfaRequired` o
  `mfaSetupRequired` y la app le indica que use el panel web.

### Auth (`/auth`, rate limit estricto)

| Método | Ruta | Notas |
|---|---|---|
| GET 🔓 | `/auth/captcha` | reto PoW |
| POST 🔓 | `/auth/register` | 5.3 |
| POST 🔓 | `/auth/verify-email` | 5.3 |
| POST 🔓 | `/auth/resend-verification` | 5.3 |
| POST 🔓 | `/auth/login` | 5.4 |
| POST 🔓 | `/auth/2fa/verify` | requiere `mfaToken` |
| POST 🔓 | `/auth/2fa/setup` · `/auth/2fa/enable` | con `mfaToken` de setup o sesión admin |
| POST 🔓 | `/auth/refresh` | 5.6 |
| POST | `/auth/logout` · `/auth/logout-all` | |
| POST 🔓 | `/auth/forgot-password` · `/auth/reset-password` | 5.7 |

### Mi perfil (`/me`)

| Método | Ruta | Notas |
|---|---|---|
| GET | `/me` | nombre, correo, rol, fecha_registro, 2FA activo |
| PATCH | `/me` | solo `nombre` |
| PATCH | `/me/password` | `{passwordActual, nuevaPassword}`; revoca las demás sesiones |
| GET | `/me/reports` | paginado, incluye los anónimos propios |
| GET | `/me/comments` | paginado, sin los `eliminado` |

### Catálogos

| Método | Ruta | Notas |
|---|---|---|
| GET | `/platforms` · `/categories` | solo `activa = TRUE` |

### Reportes

| Método | Ruta | Notas |
|---|---|---|
| GET | `/reports` | feed paginado. Query: `q`, `plataforma`, `categoria`, `estado`, `orden` = `recientes` \| `populares`, `page`, `limit` |
| GET | `/reports/:id` | detalle |
| POST | `/reports` | `multipart/form-data`: título, descripción, URL, plataforma, categoría, anónimo + hasta 5 imágenes |
| PATCH | `/reports/:id` | autor + `pendiente` (atómico) |
| DELETE | `/reports/:id` | autor + `pendiente` (atómico) |
| GET 🔓 | `/evidences/:id?exp&sig` | URL firmada (sección 6) |
| POST / DELETE | `/reports/:id/like` | idempotente; no al reporte propio |

### Comentarios

| Método | Ruta | Notas |
|---|---|---|
| GET | `/reports/:id/comments` | paginado, solo `visible` |
| POST | `/reports/:id/comments` | notifica al autor del reporte |
| DELETE | `/comments/:id` | solo el autor → `eliminado` |
| POST | `/comments/:id/flags` | no al propio; una vez por usuario |

### Notificaciones

| Método | Ruta | Notas |
|---|---|---|
| GET | `/notifications` · `/notifications/unread-count` | paginado, filtro `leida` |
| PATCH | `/notifications/:id/read` · `/notifications/read-all` | solo propias |

### Admin (`/admin`, todo 👑)

| Método | Ruta | Notas |
|---|---|---|
| GET | `/admin/reports` | cola, filtro `estado` (default `pendiente`) |
| POST | `/admin/reports/:id/review` | solo `pendiente`, no propio |
| DELETE | `/admin/reports/:id/evidences/:evidenceId` | auditado |
| GET | `/admin/comments/flagged` | `oculto_auto` y con denuncias no resueltas |
| PATCH | `/admin/comments/:id` | `{accion: "confirmar" \| "restaurar"}` |
| GET | `/admin/users` | paginado, búsqueda por nombre/correo |
| PATCH | `/admin/users/:id/status` | no a sí mismo; no deja el sistema sin admins activos |
| GET | `/admin/stats` | estadísticas de la sección 1, regla 11 |
| GET | `/admin/audit-log` | paginado, filtros por acción, usuario y fechas |

---

## 8. Seed del primer admin

`npm run seed:admin` (`api/scripts/seed-admin.ts`):

- Lee `SEED_ADMIN_NOMBRE` y `SEED_ADMIN_CORREO` del entorno.
- Si ya existe cualquier admin, aborta sin hacer nada.
- Genera una contraseña aleatoria fuerte (24+ caracteres), la hashea con
  Argon2id, crea el usuario (`rol = 'admin'`, `correo_verificado = TRUE`) y
  muestra la contraseña una sola vez en la consola (no se escribe en archivos).
- Audita `admin_creado` con `detalle: { via: "seed" }`.
- En el primer login ese admin queda obligado a configurar 2FA (ver 5.4).

---

## 9. Fases de trabajo (historial)

El desarrollo se organizó por fases, cada una en su propia rama, integrada
a `main` por pull request:

- **Fase 0** — Base del repo: estructura de carpetas, proyecto Nest con
  TypeScript `strict`, ESLint + Prettier.
- **Fase 1** — Línea base de seguridad: config validada con zod, `main.ts`,
  logger con redacción, filtro de excepciones, requestId, guards globales,
  throttler, Swagger condicional, `GET /health`.
- **Fase 2** — Datos y servicios base: entidades TypeORM, módulo de BD,
  `AuditService`, `MailService`, `StorageService`, seed del admin.
- **Fase 3** — Autenticación (sección 5 completa) + módulo `/me`.
- **Fase 4** — Catálogos, reportes, evidencias, likes.
- **Fase 5** — Comentarios, denuncias, notificaciones.
- **Fase 6** — Admin (revisión, moderación, usuarios, catálogos, stats, bitácora).
- **Fase 7** — Calidad y entrega: pruebas unitarias y e2e de seguridad
  (IDOR, mass assignment, rate limiting, anonimato, etc.), exportación de
  OpenAPI, CI (lint, tests, build, `npm audit`), CodeQL, Dependabot,
  `docs/seguridad.md` y README completo.

**Estado**: las fases 0-7 están completas. El alcance se redujo en las
fases 4-6 por la fecha de entrega original (CRUD de evidencias sueltas,
gestión de catálogos desde el panel, creación de admins desde la API y
estadísticas por mes quedaron pospuestos; ninguno de esos recortes afecta
seguridad). El proyecto se presentó al socio formador y se evaluó con
pruebas de penetración; el trabajo restante es mantenimiento y pulido
final, no nuevas fases.
