# CLAUDE.md — Backend de ClickSafe

> Este archivo es tu contexto permanente para este repositorio. Léelo completo
> antes de hacer cualquier cosa. Si algo aquí contradice lo que "normalmente"
> harías, **gana este archivo**. Si algo no está cubierto o es ambiguo,
> **pregunta antes de inventar**.

---

## 0. Cómo debes trabajar conmigo

- **Idioma:** respóndeme siempre en español. El código (nombres de variables,
  clases, funciones) va en inglés, **excepto** los nombres de tablas y columnas
  de la base de datos, que ya existen en español y NO se renombran.
- **Explica lo que haces.** Soy estudiante y este proyecto es para la materia
  *Integración de seguridad informática en redes y sistemas de software*
  (Tec de Monterrey). Al terminar cada paso explícame en detalle:
  1. qué hiciste y por qué,
  2. cómo funciona,
  3. si es un control de seguridad: **qué ataque concreto previene** y cómo
     sería ese ataque si no existiera el control.
- **Trabaja por fases** (sección 9). Al terminar cada fase: detente, corre
  lint + tests + build, resume lo hecho y espera mi confirmación antes de
  seguir con la siguiente.
- **Nunca** desactives una validación, un guard o una regla de seguridad para
  "hacer que algo funcione". Si algo choca con una regla de este archivo,
  detente y pregúntame.
- **Nunca** escribas secretos reales en el código ni en archivos versionados.
- Si necesitas instalar un paquete, dime cuál, para qué y verifica que esté
  mantenido (última publicación reciente, sin vulnerabilidades en
  `npm audit`). Prefiere pocas dependencias.
- Mi sistema operativo es **Windows**. Los comandos que me pidas correr deben
  funcionar en PowerShell. Los scripts del proyecto deben ser scripts de npm
  (multiplataforma), no scripts de bash.

---

## 1. Qué es ClickSafe

App iOS (SwiftUI, la desarrolla el resto del equipo en Mac) tipo red social
para **reportar publicaciones sospechosas de fraude en tiendas en línea**.
Socio formador: Red por la Ciberseguridad (ONG mexicana de ciberseguridad y
derechos digitales). Este repo contiene la **API REST en NestJS** que usa la
app. Más adelante contendrá también el **sitio web de administrador**.

**Requisito del curso:** cumplir **OWASP ASVS nivel 2**. La seguridad es la
prioridad número uno; el proyecto será sometido a pruebas de penetración
(nmap, Nessus, OWASP ZAP contra la API y el sitio de admin) y a análisis de
código estático.

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
   Un like por usuario por reporte. No puedes dar like a tu propio reporte.
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
   5 por reporte. Son públicas. La app mostrará al usuario una advertencia de
   no subir datos personales.
9. **Notificaciones**: solo dentro de la app (no push). Tipos:
   `reporte_validado`, `reporte_rechazado`, `nuevo_comentario` (al autor del
   reporte, si el comentario no es suyo), `comentario_ocultado` (al autor del
   comentario). **Los mensajes nunca incluyen el nombre de quien comentó.**
10. **Catálogos** (`Plataforma`, `Categoria_fraude`): los administra solo el
    admin. No se borran, se desactivan (`activa = FALSE`). Los desactivados
    no aparecen al crear reportes, pero los reportes viejos los conservan.
11. **Dashboard admin**: estadísticas de reportes por plataforma (todas las
    de `es_otra` agrupadas como "Otra"), por categoría, por estado y por mes.
12. **Correo**: no se usan servicios externos. En desarrollo se usa
    **Mailpit** (servidor SMTP local que atrapa los correos y los muestra en
    una interfaz web en `http://localhost:8025`). En la topología de red será
    un nodo "servidor de correo".
13. **Captcha**: proof-of-work (protocolo ALTCHA), sin servicios externos.

---

## 2. Stack y decisiones técnicas (no cambiar sin preguntarme)

| Tema | Decisión |
|---|---|
| Runtime | Node.js LTS (verifica con `node -v`; mínimo 22, recomendado 24) |
| Framework | NestJS (última versión estable) con TypeScript en modo `strict` |
| Gestor de paquetes | npm (commitea `package-lock.json`) |
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
| TOTP | `otplib` (+ `qrcode` para generar el QR de configuración) |
| Captcha | `altcha-lib` (si no funciona con el sistema de módulos del proyecto, implementa el protocolo con `node:crypto`: reto = SHA-256(salt + número), firma = HMAC-SHA256) |
| Correo | `nodemailer` apuntando a Mailpit |
| Docs API | `@nestjs/swagger` (OpenAPI) |
| Tests | Jest (viene con Nest) + `supertest` para e2e |

### La base de datos es la fuente de verdad
- El esquema vive en `database/clicksafe_db.sql` y **ya fue probado**. Las
  entidades de TypeORM deben **reflejarlo exactamente** (mismos nombres de
  tabla y columna, tipos, nullabilidad, longitudes). Usa `@Entity('Reporte')`,
  `@Column({ name: 'fecha_creacion' })`, etc.
- **Nunca** uses `synchronize: true` ni generes migraciones que alteren el
  esquema. Si una funcionalidad necesita cambiar el esquema, **detente y
  pregúntame**: el cambio se hace primero en el `.sql`.
- Conexión con `timezone: 'Z'` (todas las fechas en UTC).
- La API se conecta con el usuario de BD **`clicksafe_api`** (mínimo
  privilegio, ver sección 6 del `.sql`), **nunca con root**. Ten en cuenta
  sus permisos: por ejemplo, no tiene `DELETE` sobre `Usuario`, `Comentario`
  ni `Bitacora_auditoria`, ni `UPDATE` sobre `Bitacora_auditoria`.

---

## 3. Estructura del repositorio

```
/
├── CLAUDE.md                 ← este archivo
├── README.md                 ← cómo levantar el proyecto (en español)
├── .gitignore  .gitattributes  .editorconfig
├── database/
│   └── clicksafe_db.sql      ← esquema + catálogos + usuario de mínimo privilegio
├── infra/
│   └── docker-compose.yml    ← OPCIONAL: MySQL 8 + Mailpit para desarrollo
├── docs/
│   ├── openapi.json          ← exportado con `npm run openapi:export`
│   └── seguridad.md          ← controles de seguridad ↔ requisitos ASVS
├── api/                      ← proyecto NestJS
│   ├── src/
│   │   ├── main.ts
│   │   ├── app.module.ts
│   │   ├── config/           ← esquema zod del .env y config tipada
│   │   ├── common/           ← guards, decorators, filters, interceptors, pipes, utils
│   │   ├── database/         ← módulo TypeORM y entidades
│   │   ├── audit/            ← servicio de bitácora
│   │   ├── mail/             ← servicio de correo (Mailpit)
│   │   ├── storage/          ← StorageService (interfaz) + implementación en disco
│   │   ├── captcha/
│   │   ├── auth/
│   │   ├── me/
│   │   ├── catalogs/         ← plataformas y categorías (lectura)
│   │   ├── reports/          ← reportes, evidencias, likes
│   │   ├── comments/         ← comentarios y denuncias
│   │   ├── notifications/
│   │   └── admin/
│   ├── scripts/              ← seed-admin.ts, export-openapi.ts
│   ├── test/                 ← e2e
│   ├── .env.example
│   └── package.json
└── admin-web/                ← (fase posterior) sitio web del administrador
```

- `.gitattributes`: `* text=auto eol=lf` (el equipo mezcla Windows y Mac).
- `.gitignore` debe incluir: `node_modules/`, `dist/`, `coverage/`, `.env`,
  `.env.*` (excepto `.env.example`), la carpeta de almacenamiento de
  archivos subidos, `*.pem`, `*.key`, `*.crt`.

---

## 4. Seguridad transversal (aplica a TODA la API)

### 4.1 Arranque (`main.ts`)
- Prefijo global `/api/v1`.
- `helmet()` con su configuración por defecto (la API solo devuelve JSON e imágenes).
- CORS **deshabilitado** por defecto (la app iOS no lo necesita y el sitio de
  admin se servirá en el mismo origen detrás de Nginx). Habilitarlo solo si
  `CORS_ORIGINS` tiene valores, y solo para esos orígenes exactos.
- Límite de tamaño del body JSON: `100kb`.
- `trust proxy` activado **solo si** `TRUST_PROXY=true` (cuando esté detrás de
  Nginx). Si se activa sin proxy, un atacante podría falsificar su IP con el
  header `X-Forwarded-For` y evadir el rate limiting.
- `ValidationPipe` global con:
  `whitelist: true, forbidNonWhitelisted: true, transform: true,
  transformOptions: { enableImplicitConversion: false }`.
  Esto previene **mass assignment**: si alguien manda `"rol": "admin"` o
  `"estado": "validado"` en un body, la petición se rechaza.
- Swagger en `/api/docs` **solo si** `SWAGGER_ENABLED=true` (en producción
  exponer la documentación da un mapa gratis al atacante).
- `app.enableShutdownHooks()`.

### 4.2 Configuración
- Todas las variables de entorno se validan con zod **al arrancar**. Si falta
  una o no cumple el formato (p. ej. un secreto de menos de 32 bytes), la API
  **no inicia** y muestra qué falta (sin mostrar valores).
- `.env.example` con todas las variables, valores de ejemplo NO reales, y un
  comentario de cómo generar cada secreto:
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
- Secretos separados (una clave por propósito, nunca reutilizar):
  `JWT_ACCESS_SECRET`, `JWT_MFA_SECRET`, `TOTP_ENCRYPTION_KEY` (32 bytes,
  AES-256-GCM), `CODE_HMAC_KEY` (códigos de correo), `CAPTCHA_HMAC_KEY`,
  `EVIDENCE_URL_SECRET` (URLs firmadas), `DB_PASSWORD`.

### 4.3 Autorización: denegación por defecto
- Guards **globales** (vía `APP_GUARD`) en este orden:
  1. `ThrottlerGuard`
  2. `JwtAuthGuard` — toda ruta requiere token **excepto** las marcadas con `@Public()`.
  3. `RolesGuard` — rutas con `@Roles('admin')` requieren rol admin **y**
     que la sesión se haya completado con 2FA.
- El `JwtAuthGuard`, además de verificar la firma y expiración, consulta que
  **la sesión (`sid` del token) no esté revocada y que el usuario siga
  `activo`**. Así un logout o una suspensión surten efecto de inmediato y no
  hasta que expire el token.
- **Control de propiedad (anti-BOLA/IDOR)**: toda operación sobre un recurso
  de un usuario (editar/borrar reporte, borrar comentario, marcar
  notificación, etc.) filtra **en la misma consulta** por el id del usuario
  autenticado. Nunca "busco por id y luego verifico". Si el recurso no existe
  **o no es tuyo**, responde **404** (no 403) para no revelar que existe.
- Las operaciones condicionadas a un estado se hacen **atómicas**:
  `UPDATE Reporte SET ... WHERE id_reporte = ? AND id_usuario = ? AND estado = 'pendiente'`
  y se revisan las filas afectadas. Esto previene la condición de carrera
  (TOCTOU) en la que el autor edita justo mientras un admin lo valida.

### 4.4 Rate limiting
- Global: 100 peticiones / minuto por IP.
- Rutas de `/auth/*`: 5 / minuto por IP (login, registro, recuperación, verificación).
- Creación de reportes: 10 / hora por usuario. Comentarios: 30 / hora. Denuncias: 20 / hora.
- Los límites "por usuario" usan un `getTracker` propio que toma el `sub`
  del token (si no hay token, la IP).
- Todos los límites se leen del `.env` (con estos valores por defecto) para
  poder ajustarlos en la demo sin tocar código.
- Respuesta 429 genérica.

### 4.5 Errores y logs
- Filtro global de excepciones: la respuesta **nunca** incluye stack traces,
  mensajes de MySQL/TypeORM ni rutas del servidor. Formato:
  `{ "statusCode": 400, "error": "Bad Request", "message": "...", "requestId": "..." }`.
  Errores 500 → mensaje genérico; el detalle solo va al log con el `requestId`.
- Violaciones de constraints de MySQL (duplicados, CHECK, FK) se traducen a
  409/400 con mensaje genérico.
- `nestjs-pino` con `redact` para: `req.headers.authorization`,
  `req.headers.cookie`, y cualquier campo `password`, `passwordActual`,
  `nuevaPassword`, `token`, `refreshToken`, `codigo`, `totp`.
- Cada petición lleva un `requestId` (UUID) que se devuelve en el header
  `X-Request-Id`.

### 4.6 Bitácora de auditoría (`Bitacora_auditoria`)
`AuditService.log({ idUsuario, accion, resultado, recursoTipo, recursoId, ip, userAgent, detalle })`.
Registrar como mínimo: `login` (éxito/fallo), `cuenta_bloqueada`, `logout`,
`refresh_reuso_detectado`, `registro`, `correo_verificado`,
`password_recuperacion_solicitada`, `password_cambiada`, `2fa_activado`,
`2fa_fallo`, `reporte_revisado`, `comentario_moderado`, `usuario_suspendido`,
`usuario_reactivado`, `admin_creado`, `catalogo_modificado`.
**`detalle` nunca contiene contraseñas, tokens, códigos ni secretos.**
Si falla escribir la bitácora, se registra en el log de la app pero no
se revela al cliente.

### 4.7 Validación de entradas
- Todo body, query y param tiene un DTO con `class-validator`. Ids de ruta con
  `ParseIntPipe` (y rango > 0).
- Longitudes máximas iguales a las del esquema SQL.
- Strings: `trim`, y rechazar caracteres de control (excepto `\n` en
  descripciones/comentarios) y bytes nulos.
- **No** sanitizar HTML modificando el texto: se guarda tal cual y se devuelve
  como JSON; la app SwiftUI y el sitio de admin (React) lo muestran como texto
  plano, lo que previene XSS. **Nunca** renderizar contenido de usuarios como HTML.
- Paginación en todo listado: `page` ≥ 1, `limit` entre 1 y 50 (default 20).
  Evita que alguien pida un millón de filas y tumbe el servidor.
- Toda consulta usa parámetros del ORM / QueryBuilder. **Prohibido
  concatenar strings en SQL** (inyección SQL). Los campos de ordenamiento se
  eligen de una lista blanca (enum), nunca se pasan directo desde el query.

### 4.8 URLs reportadas (riesgo específico de ClickSafe)
- `@IsUrl({ protocols: ['http','https'], require_protocol: true, require_tld: true })`,
  máximo 2048 caracteres, rechazar URLs con credenciales (`usuario:pass@host`).
- **El servidor NUNCA hace peticiones a la URL reportada** (ni para vista
  previa, ni para validarla, ni para nada). Esto previene **SSRF**: si el
  servidor visitara URLs dadas por usuarios, un atacante reportaría
  `http://10.0.x.x/...` para explorar la red interna.

---

## 5. Autenticación (detalle)

### 5.1 Contraseñas (ASVS v5, cap. 6)
- Longitud mínima 8, máxima 128. Sin reglas de composición forzadas
  (ASVS ya no las recomienda); en su lugar, rechazar contraseñas de una
  lista local de contraseñas comunes (archivo con las ~10 000 más comunes,
  sin consultar servicios externos) y contraseñas que contengan el correo o
  el nombre.
- Argon2id (sección 2). Nunca comparar contraseñas con `===`.

### 5.2 Captcha proof-of-work
- `GET /auth/captcha` (público) devuelve un reto ALTCHA que expira en 5 min.
- Obligatorio en: registro, login, reenviar código, olvidé contraseña,
  restablecer contraseña. Se manda en el body como `captcha` (payload en base64).
- Al verificar: comprobar firma HMAC, expiración y que la firma **no esté en
  `Captcha_usado`**; luego insertarla (previene reutilizar un captcha
  resuelto = ataque de repetición). Tarea programada que borra los expirados.

### 5.3 Registro y verificación de correo
- `POST /auth/register {nombre, correo, password, captcha}`.
- El correo se normaliza (trim + minúsculas).
- **Respuesta idéntica** exista o no el correo:
  `202 { message: "Si el correo es válido, recibirás un código de verificación." }`.
  Si ya existía, en vez del código se le manda al dueño un correo avisando
  que alguien intentó registrarse con su dirección. Previene **enumeración
  de usuarios**.
- Se envía un **código numérico de 6 dígitos** (generado con
  `crypto.randomInt`), válido 30 min, máx. 5 intentos. Se guarda en
  `Token_verificacion` como `HMAC-SHA256(CODE_HMAC_KEY, id_usuario:tipo:codigo)`
  en hex. Al emitir un código nuevo, se invalidan los anteriores del mismo tipo.
- `POST /auth/verify-email {correo, codigo}` → marca `correo_verificado`.
  Respuesta genérica en error. Comparar hashes con `crypto.timingSafeEqual`.
- `POST /auth/resend-verification {correo, captcha}` → respuesta genérica.
- No se puede iniciar sesión sin correo verificado.

### 5.4 Login
- `POST /auth/login {correo, password, captcha}`.
- Si el usuario no existe, **igual se ejecuta `argon2.verify` contra un hash
  ficticio** para que el tiempo de respuesta sea el mismo (evita enumerar
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
- **Admin** → **no** devuelve tokens de sesión. Devuelve un `mfaToken`
  (JWT firmado con `JWT_MFA_SECRET`, `typ: "mfa"`, 5 min) y:
  - si ya tiene 2FA activo: `{ mfaRequired: true, mfaToken }`
  - si aún no lo configura (p. ej. el admin del seed): `{ mfaSetupRequired: true, mfaToken }`

### 5.5 2FA para admins (TOTP)
- `POST /auth/2fa/setup` (con `mfaToken` de setup o sesión admin) → genera
  secreto, lo guarda **cifrado con AES-256-GCM** (`iv:tag:cifrado` en base64,
  clave `TOTP_ENCRYPTION_KEY`) y devuelve el URI `otpauth://` y un QR en data-URL.
- `POST /auth/2fa/enable {codigo}` → verifica el primer código y activa.
- `POST /auth/2fa/verify {mfaToken, codigo}` → si es correcto emite la sesión
  completa con claim `mfa: true`.
- Ventana de tolerancia ±1 paso (30 s). Guardar el contador usado en
  `totp_ultimo_contador` y **rechazar códigos con contador ≤ al último usado**
  (un código TOTP solo se puede usar una vez).
- 5 códigos fallidos → aplicar el mismo bloqueo del login.

### 5.6 Tokens y sesiones
- **Access token**: JWT HS256, 15 min. Claims: `sub` (id usuario), `rol`,
  `sid` (id de sesión), `mfa` (bool). Al verificar, fijar
  `algorithms: ['HS256']` (previene el ataque de confusión de algoritmo /
  `alg: none`). También validar `iss` y `aud`.
- **Refresh token**: 32 bytes aleatorios (`crypto.randomBytes`) en base64url,
  **no** es JWT. En BD solo va su SHA-256 (`Sesion.token_hash`).
  Vida: 7 días deslizantes, **30 días absolutos** (`expira_absoluta`).
- **Rotación con detección de reuso** (`POST /auth/refresh {refreshToken}`):
  cada uso marca la fila con `reemplazada_en` y crea una nueva de la misma
  `familia`. Si llega un token **ya reemplazado** → se revoca **toda la
  familia**, se audita `refresh_reuso_detectado` y se responde 401. (Si
  alguien robó el token, el ladrón y la víctima quedan fuera y la víctima
  vuelve a iniciar sesión; el ladrón ya no puede.)
- `POST /auth/logout` → revoca la sesión actual.
  `POST /auth/logout-all` → revoca todas las sesiones del usuario.
- Cambiar contraseña, restablecerla, suspender usuario → revocar todas sus sesiones.
- La app iOS guardará los tokens en el Keychain (no es responsabilidad de
  este repo, pero documéntalo en el README para el equipo).

### 5.7 Recuperación de contraseña
- `POST /auth/forgot-password {correo, captcha}` → respuesta genérica siempre.
  Si existe y está activo, se envía un código de **8 dígitos**, válido 15 min,
  máx. 5 intentos (mismo mecanismo HMAC de 5.3).
- `POST /auth/reset-password {correo, codigo, nuevaPassword, captcha}` →
  cambia la contraseña, marca el código como usado, reinicia el bloqueo,
  revoca todas las sesiones, audita y envía un correo avisando del cambio.

---

## 6. Evidencias (subida de archivos)

1. `multer` con `memoryStorage`, `limits: { fileSize: 5 MB, files: 5 }`.
2. **Ignorar** el nombre del archivo y el `Content-Type` que manda el cliente
   (ambos los controla el atacante).
3. Detectar el formato real con `sharp(buffer, { limitInputPixels: 25_000_000 }).metadata()`.
   Solo se aceptan `jpeg`, `png`, `webp`. El límite de píxeles previene las
   **"bombas de descompresión"** (una imagen de pocos KB que al abrirse ocupa GB de RAM).
4. **Re-codificar** siempre: redimensionar a máx. 2048 px por lado y guardar
   como **WebP** (calidad ~80). Sharp **no copia metadatos** por defecto:
   **no** llamar a `.withMetadata()`. Esto elimina el EXIF (incluida la
   ubicación GPS) y destruye cualquier contenido incrustado (polyglots).
5. Nombre = `uuid v4 + .webp`. Ruta relativa `evidencias/AAAA/MM/<uuid>.webp`
   dentro de `STORAGE_DIR` (fuera de la carpeta del código). Al resolver la
   ruta absoluta, verificar que siga dentro de `STORAGE_DIR` (**path traversal**).
6. Guardar en `Evidencia` el tamaño final y el SHA-256 del archivo final.
7. `StorageService` es una interfaz (`save`, `read`, `delete`) con una
   implementación en disco; más adelante habrá otra para MinIO.
8. **Servir imágenes con URL firmada**: en las respuestas de reportes, cada
   evidencia trae una URL
   `/api/v1/evidences/:id?exp=<unix>&sig=<HMAC>` válida 15 min
   (`HMAC-SHA256(EVIDENCE_URL_SECRET, id:exp)`). Esa ruta es `@Public()` pero
   solo responde si la firma es válida y no ha expirado. Así `AsyncImage` de
   SwiftUI puede cargar imágenes sin headers y aun así los enlaces no son
   permanentes ni adivinables.
   Headers de respuesta: `Content-Type: image/webp`,
   `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'`,
   `Cache-Control: private, max-age=900`.
9. Si falla cualquier paso después de guardar el archivo, borrar el archivo
   (no dejar huérfanos). Al borrar un reporte, borrar sus archivos.

---

## 7. Endpoints

Todos bajo `/api/v1`. 🔓 = `@Public()`. 👑 = admin + 2FA. El resto requiere
usuario autenticado. Todas las respuestas documentadas en Swagger con sus DTOs.

**Contrato común** (la app iOS ya se está programando contra esto; no lo cambies sin avisarme):
- JSON de respuesta en **camelCase** (`urlPublicacion`, `totalLikes`, `fechaCreacion`).
  Los bodies de petición usan los nombres indicados en cada endpoint.
- Fechas en ISO 8601 UTC con `Z` (`2026-09-26T18:30:00.000Z`).
- Listados paginados: `{ "items": [...], "page": 1, "limit": 20, "total": 134 }`.
- Errores: el formato de 4.5. Cuando la app necesita distinguir un caso, se
  agrega un campo `code` estable. Lista cerrada (agregar uno nuevo = avisarme,
  porque la app los traduce a mensajes): `EMAIL_NOT_VERIFIED`, `CAPTCHA_INVALID`,
  `INVALID_CODE` (código de correo incorrecto o expirado), `PASSWORD_WEAK`,
  `REPORT_NOT_EDITABLE`, `EVIDENCE_LIMIT`, `INVALID_IMAGE`, `OWN_REPORT`
  (like o revisión a reporte propio), `OWN_COMMENT` (denunciar comentario
  propio), `ALREADY_FLAGGED`, `CATALOG_INACTIVE`, `PLATFORM_OTHER_REQUIRED`.
- La app iOS es **solo para usuarios** (`rol = 'usuario'`). Los admins usan el
  sitio web. Si un admin inicia sesión en la app, la app recibe `mfaRequired`
  o `mfaSetupRequired` y le muestra que use el panel web.

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
| GET | `/platforms` · `/categories` | solo `activa = TRUE` |
|---|---|---|

### Reportes
| Método | Ruta | Notas |
|---|---|---|
| GET | `/reports` | feed paginado. Query: `q` (texto, máx. 100, busca en `titulo`, `descripcion` y `url_publicacion` con `LIKE` parametrizado **escapando `%`, `_` y `\`**), `plataforma` (id), `categoria` (id), `estado`, `orden` = `recientes` \| `populares` (enum), `page`, `limit` |
| GET | `/reports/:id` | detalle |
| POST | `/reports` | `multipart/form-data`: `titulo`, `descripcion`, `urlPublicacion`, `plataformaId`, `plataformaOtra?`, `categoriaId`, `anonimo` (`"true"`/`"false"`) + hasta 5 imágenes en el campo `evidencias` |
| PATCH | `/reports/:id` | JSON con cualquiera de: `titulo`, `descripcion`, `urlPublicacion`, `plataformaId`, `plataformaOtra`, `categoriaId`, `anonimo`. Autor + `pendiente` (atómico) |
| DELETE | `/reports/:id` | autor + `pendiente` (atómico) |
| POST | `/reports/:id/evidences` | autor + `pendiente`, respetando máx. 5 en total |
| DELETE | `/reports/:id/evidences/:evidenceId` | autor + `pendiente` |
| GET 🔓 | `/evidences/:id?exp&sig` | URL firmada (sección 6) |
| POST | `/reports/:id/like` | idempotente; no a reporte propio |
| DELETE | `/reports/:id/like` | idempotente |

Forma de un reporte en respuestas:
```json
{
  "id": 12, "titulo": "...", "descripcion": "...", "urlPublicacion": "https://...",
  "plataforma": { "id": 3, "nombre": "Otra" }, "plataformaOtra": "TiendaX",
  "categoria": { "id": 1, "nombre": "Producto no entregado" },
  "estado": "validado", "anonimo": false,
  "autor": { "nombre": "Ana" },            // null si anonimo = true
  "esMio": false, "likedByMe": true, "totalLikes": 14, "totalComentarios": 3,
  "evidencias": [ { "id": 5, "url": "/api/v1/evidences/5?exp=...&sig=..." } ],
  "revision": { "decision": "validado", "comentario": "...", "fecha": "..." }, // null si pendiente; SIN datos del admin
  "fechaCreacion": "...", "fechaActualizacion": "..."
}
```
Otras formas de respuesta (contrato con la app iOS):
```json
// Plataforma            { "id": 1, "nombre": "Mercado Libre", "esOtra": false }
// Categoría             { "id": 1, "nombre": "Producto no entregado", "descripcion": "..." }
// Comentario            { "id": 7, "contenido": "...", "anonimo": true, "autor": null, "esMio": false, "fechaCreacion": "..." }
// Notificación          { "id": 3, "tipo": "reporte_validado", "mensaje": "...", "leida": false, "reporteId": 12, "fechaCreacion": "..." }
// GET /me               { "nombre": "...", "correo": "...", "rol": "usuario", "fechaRegistro": "...", "totpActivo": false }
// Mis comentarios       Comentario + { "reporteId": 12, "reporteTitulo": "...", "estado": "visible" | "oculto_auto" | "oculto_admin" }
// Tokens                { "accessToken": "...", "refreshToken": "...", "expiresIn": 900 }
// Captcha (ALTCHA)      { "algorithm": "SHA-256", "challenge": "<hex>", "maxnumber": 100000, "salt": "...", "signature": "<hex>" }
// Like                  { "totalLikes": 15, "likedByMe": true }
// Unread count          { "count": 4 }
```
Validación de campos de reporte: `titulo` 1–150, `descripcion` 20–5000,
`plataformaOtra` 1–100, comentario `contenido` 1–1000, denuncia `detalle` ≤ 255.

Usa clases de respuesta + `ClassSerializerInterceptor` o mappers explícitos
para que **nunca** se filtre una entidad cruda (con `id_usuario`,
`password_hash`, etc.) en una respuesta.

Likes: en una transacción, `INSERT` (si ya existe por la PK compuesta, no
hacer nada) y solo si se insertó, `total_likes = total_likes + 1`. Lo mismo al
quitar. Nunca `total_likes = <valor calculado en Node>` (condición de carrera).

### Comentarios
| Método | Ruta | Notas |
|---|---|---|
| GET | `/reports/:id/comments` | paginado, solo `visible`, autor `null` si anónimo, `esMio` |
| POST | `/reports/:id/comments` | `{contenido (1–1000), anonimo}`; notifica al autor del reporte |
| DELETE | `/comments/:id` | solo el autor → `eliminado` |
| POST | `/comments/:id/flags` | `{motivo (enum), detalle?}`; no al propio; una vez por usuario; regla del umbral en transacción |

### Notificaciones
| GET | `/notifications` (paginado, filtro `leida`) · `/notifications/unread-count` |
|---|---|
| PATCH | `/notifications/:id/read` (solo propias) · `/notifications/read-all` |

### Admin (`/admin`, todo 👑)
| Método | Ruta | Notas |
|---|---|---|
| GET | `/admin/reports` | cola, filtro `estado` (default `pendiente`), incluye autor real (nombre+correo) aunque sea anónimo |
| POST | `/admin/reports/:id/review` | `{decision, comentario?}`; solo `pendiente`, no propio; transacción: estado + `Revision_reporte` + notificación + auditoría |
| DELETE | `/admin/reports/:id/evidences/:evidenceId` | para quitar imágenes con datos personales (en cualquier estado); auditado |
| GET | `/admin/comments/flagged` | `oculto_auto` y comentarios con denuncias no resueltas |
| PATCH | `/admin/comments/:id` | `{accion: "confirmar" \| "restaurar"}` |
| GET | `/admin/users` | paginado, búsqueda por nombre/correo |
| PATCH | `/admin/users/:id/status` | `{activo}`; no a sí mismo; no dejar el sistema sin admins activos; revoca sesiones |
| POST | `/admin/admins` | `{nombre, correo, totp}` — **re-autenticación**: exige un código TOTP actual del admin que crea. Crea la cuenta con contraseña inutilizable + `correo_verificado = TRUE` y envía un código de recuperación para que el nuevo admin defina su contraseña (nadie conoce la contraseña de otro). Auditado |
| GET/POST/PATCH | `/admin/platforms`, `/admin/categories` | alta, edición, activar/desactivar. Sin DELETE |
| GET | `/admin/stats` | sección 1, regla 11 |
| GET | `/admin/audit-log` | paginado, filtros por acción, usuario y fechas |

---

## 8. Seed del primer admin

`npm run seed:admin` (script en `api/scripts/seed-admin.ts`):
- Lee `SEED_ADMIN_NOMBRE` y `SEED_ADMIN_CORREO` del entorno.
- Si ya existe **cualquier** admin, aborta sin hacer nada.
- Genera una contraseña aleatoria fuerte (24+ caracteres), la hashea con
  Argon2id, crea el usuario (`rol = 'admin'`, `correo_verificado = TRUE`) y
  **muestra la contraseña una sola vez en la consola** (no la escribe en archivos).
- Audita `admin_creado` con `detalle: { via: "seed" }`.
- En el primer login ese admin estará obligado a configurar 2FA (5.4).

---

## 9. Fases de trabajo

Cada fase va en su propia rama (ver sección 10). Al final de cada una:
`npm run typecheck`, `npm run lint`, `npm test`, `npm run build` deben pasar
sin errores ni warnings. Detente y explícame.

`npm run typecheck` (`tsc --noEmit` sobre `tsconfig.typecheck.json`, que
cubre `src/`, `scripts/` y `test/` en un solo programa) existe porque
`npm run build` y `npm run lint` no necesariamente revisan los mismos
archivos: `nest build` sigue `tsconfig.build.json`, el lint sigue su propio
glob, y `ts-node` (usado por `seed:admin` y scripts similares) resuelve su
programa siguiendo los `import` desde el archivo de entrada, no todo el
proyecto. Un archivo de tipos ambiental sin importar en ningún lado (p. ej.
una declaración global) puede quedar invisible para `ts-node` aunque
`build`/`lint` sí lo vean. `typecheck` fija ese árbol de archivos de forma
explícita para que los tres comandos revisen siempre el mismo universo.

**Fase 0 — Base del repo**
Estructura de carpetas, `.gitignore`, `.gitattributes`, `.editorconfig`,
`README.md` inicial, mover el `.sql` a `database/`, `infra/docker-compose.yml`
(MySQL 8 + Mailpit, puertos solo en `127.0.0.1`), proyecto Nest en `api/`
con TypeScript `strict` y ESLint + Prettier.

**Fase 1 — Línea base de seguridad**
Config validada con zod, `main.ts` (4.1), logger con redacción, filtro de
excepciones, requestId, guards globales con `@Public()` y `@Roles()`,
throttler, Swagger condicional, endpoint `GET /health` 🔓 (solo
`{status:"ok"}`, sin versiones ni detalles internos).

**Fase 2 — Datos y servicios base**
Entidades TypeORM que reflejen el `.sql` exactamente, módulo de BD,
`AuditService`, `MailService` (Mailpit), `StorageService`, seed del admin.

**Fase 3 — Autenticación** (sección 5 completa) + módulo `/me`.

**Fase 4 — Catálogos, reportes, evidencias, likes.**

**Fase 5 — Comentarios, denuncias, notificaciones.**

**Fase 6 — Admin** (revisión, moderación, usuarios, admins, catálogos, stats, bitácora).

**Fase 7 — Calidad y entrega**
- **Pruebas unitarias** (Jest, repositorios mockeados) para los requerimientos
  de **lectura de datos**, cada una con un **escenario exitoso y uno fallido**
  (p. ej.: feed de reportes, detalle de reporte inexistente, mis
  notificaciones, catálogos, estadísticas admin). Lo exige el reporte del curso.
- **Pruebas e2e de seguridad** con supertest contra una BD de pruebas
  `clicksafe_test`: IDOR (editar reporte ajeno → 404), mass assignment
  (`rol` en registro → 400), usuario normal en ruta admin → 403, token
  manipulado → 401, reuso de refresh token → revoca familia, rate limit → 429,
  subida de archivo no-imagen → 400, anonimato (la respuesta no contiene datos
  del autor).
- `npm run openapi:export` → genera `docs/openapi.json` sin levantar el servidor HTTP.
- GitHub Actions (`.github/workflows/ci.yml`): instalar con `npm ci`, lint,
  tests, build, `npm audit --audit-level=high`. Workflow de **CodeQL** para
  análisis estático. `dependabot.yml` para npm y GitHub Actions.
- `docs/seguridad.md`: tabla de cada control implementado → ataque que
  previene → requisito de ASVS 5.0 que cubre → archivo donde está.
- README completo en español: requisitos, cómo crear la BD, el usuario
  `clicksafe_api`, el `.env`, Mailpit, seed del admin, correr y probar.

---

## 10. Git

- `main` siempre debe compilar y funcionar. **Nunca** commitear directo a `main`.
- Una rama por fase o funcionalidad: `feat/fase-0-base`, `feat/auth`,
  `feat/reports`, `fix/...`, `docs/...`. Se integra a `main` con un Pull Request.
- Commits pequeños con Conventional Commits en español:
  `feat(auth): rotación de refresh tokens con detección de reuso`.
- Antes de cada commit, revisa `git diff --staged` en busca de secretos o
  archivos `.env`. Si detectas un secreto commiteado, avísame de inmediato
  (hay que rotarlo; borrarlo del historial no basta).
- No hagas `push --force` a `main`.

---

## 11. Cosas que NUNCA debes hacer

- `synchronize: true`, o conectarte a MySQL como root desde la app.
- Concatenar strings en consultas SQL.
- Devolver entidades crudas de TypeORM en respuestas.
- Exponer `id_usuario`, correos o nombres de autores anónimos en respuestas públicas.
- Hacer peticiones HTTP a URLs proporcionadas por usuarios.
- Guardar contraseñas, refresh tokens, códigos o secretos TOTP en claro.
- Loguear headers `Authorization`, cookies, contraseñas, tokens o códigos.
- Usar `Math.random()` para cualquier cosa de seguridad (usar `node:crypto`).
- Comparar secretos con `===` (usar `crypto.timingSafeEqual`).
- Confiar en el `Content-Type` o nombre de archivo enviados por el cliente.
- Poner `@Public()` en una ruta que no esté marcada 🔓 en la sección 7.
- Desactivar ESLint, `strict` de TypeScript o tests para que algo pase.
