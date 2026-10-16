# ClickSafe — Backend

API REST en NestJS para ClickSafe, una app para reportar publicaciones
sospechosas de fraude en tiendas en línea. Proyecto de la materia
*Integración de seguridad informática en redes y sistemas de software*
(Tec de Monterrey), en colaboración con Red por la Ciberseguridad.

> El contexto completo del proyecto (reglas de negocio, decisiones técnicas,
> fases de trabajo) está en [CLAUDE.md](CLAUDE.md).

## Documentación

- [`docs/openapi.json`](docs/openapi.json) — contrato completo de la API
  (se regenera con `npm run openapi:export` dentro de `api/`, sin levantar
  el servidor HTTP). Con `SWAGGER_ENABLED=true` también queda interactivo en
  `/api/docs`.
- [`docs/seguridad.md`](docs/seguridad.md) — tabla de trazabilidad: cada
  control de seguridad implementado, el ataque concreto que previene, el
  requisito de OWASP ASVS 5.0 que cubre, y el archivo donde vive.
- [`docs/despliegue.md`](docs/despliegue.md) — cómo desplegar el backend en
  el laboratorio de dos PCs (Nginx, TLS propio, systemd).

## Estructura del repositorio

```
/
├── database/    esquema SQL (clicksafe_db.sql)
├── infra/       docker-compose.yml (MySQL 8 + Mailpit); alternativa opcional a instalarlos nativos
├── docs/        documentación técnica (se agrega en fases posteriores)
├── api/         API REST en NestJS
└── admin-web/   sitio web de administrador (fase posterior)
```

## Requisitos

- Node.js 22+ (recomendado 24)
- npm
- MySQL Server 8.0.16+ instalado nativamente (opción principal; ver abajo) **o** Docker Desktop (alternativa opcional, sección "Con Docker")
- [Mailpit](https://mailpit.axllent.org/) como ejecutable (`mailpit.exe`), fuera del repo

## Poner en marcha el entorno de desarrollo

Opción principal: MySQL instalado nativamente en Windows (como servicio) y
Mailpit como ejecutable suelto, sin Docker. Si prefieres Docker, salta a
["Con Docker"](#con-docker) más abajo (hace lo mismo, dentro de contenedores).

1. Instala [MySQL Community Server 8.0+](https://dev.mysql.com/downloads/mysql/)
   para Windows (el instalador lo deja corriendo como servicio en
   `127.0.0.1:3306`) y toma nota de la contraseña de `root` que elijas ahí.
2. Carga el esquema (crea la base `clicksafe_db`, sus tablas y los catálogos
   iniciales) y crea el usuario de mínimo privilegio `clicksafe_api` (la API
   nunca se conecta como root). Los permisos exactos están comentados al
   final de `database/clicksafe_db.sql`.
   ```powershell
   Get-Content database/clicksafe_db.sql | & "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -uroot -p

   & "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -uroot -p -e "
   CREATE USER IF NOT EXISTS 'clicksafe_api'@'127.0.0.1' IDENTIFIED BY '<igual a DB_PASSWORD en api/.env>';
   GRANT SELECT, INSERT, UPDATE ON clicksafe_db.Usuario TO 'clicksafe_api'@'127.0.0.1';
   GRANT SELECT, INSERT, UPDATE ON clicksafe_db.Plataforma TO 'clicksafe_api'@'127.0.0.1';
   GRANT SELECT, INSERT, UPDATE ON clicksafe_db.Categoria_fraude TO 'clicksafe_api'@'127.0.0.1';
   GRANT SELECT, INSERT, DELETE ON clicksafe_db.Captcha_usado TO 'clicksafe_api'@'127.0.0.1';
   GRANT SELECT, INSERT, UPDATE, DELETE ON clicksafe_db.Sesion TO 'clicksafe_api'@'127.0.0.1';
   GRANT SELECT, INSERT, UPDATE, DELETE ON clicksafe_db.Token_verificacion TO 'clicksafe_api'@'127.0.0.1';
   GRANT SELECT, INSERT ON clicksafe_db.Bitacora_auditoria TO 'clicksafe_api'@'127.0.0.1';
   GRANT SELECT, INSERT, UPDATE, DELETE ON clicksafe_db.Reporte TO 'clicksafe_api'@'127.0.0.1';
   GRANT SELECT, INSERT, DELETE ON clicksafe_db.Evidencia TO 'clicksafe_api'@'127.0.0.1';
   GRANT SELECT, INSERT ON clicksafe_db.Revision_reporte TO 'clicksafe_api'@'127.0.0.1';
   GRANT SELECT, INSERT, DELETE ON clicksafe_db.Like_reporte TO 'clicksafe_api'@'127.0.0.1';
   GRANT SELECT, INSERT, UPDATE ON clicksafe_db.Comentario TO 'clicksafe_api'@'127.0.0.1';
   GRANT SELECT, INSERT, UPDATE ON clicksafe_db.Denuncia_comentario TO 'clicksafe_api'@'127.0.0.1';
   GRANT SELECT, INSERT, UPDATE, DELETE ON clicksafe_db.Notificacion TO 'clicksafe_api'@'127.0.0.1';
   FLUSH PRIVILEGES;"
   ```
3. Descarga Mailpit (ejecutable, sin instalación) desde
   [sus releases](https://github.com/axllent/mailpit/releases) y guárdalo
   fuera del repo (p. ej. `C:\Users\<tú>\Documents\BackendRepo\Tools\mailpit.exe`).
   Cada vez que desarrolles, en su propia terminal:
   ```powershell
   cd C:\Users\<tú>\Documents\BackendRepo\Tools
   .\mailpit.exe --listen 127.0.0.1:8025 --smtp 127.0.0.1:1025
   ```
   - Interfaz web: `http://localhost:8025`. SMTP: `127.0.0.1:1025`.
   - `api/.env` debe tener `MAIL_HOST=127.0.0.1` y `MAIL_PORT=1025` (igual
     que `.env.example`) para que la API le hable a este Mailpit.
4. Instala las dependencias de la API y configura su `.env`:
   ```powershell
   cd api
   npm install
   Copy-Item .env.example .env
   ```
   Edita `api/.env`: genera un valor real para `JWT_ACCESS_SECRET` (mínimo
   32 caracteres) y pon en `DB_PASSWORD` la misma contraseña que usaste para
   `clicksafe_api` en el paso 2. Si `mysqldump.exe`/`mysql.exe` no están en
   tu PATH (lo normal en Windows), fija también `MYSQLDUMP_PATH`/`MYSQL_PATH`
   con su ruta completa (ver `.env.example`; los usan `npm run db:backup`/
   `npm run db:restore`, nunca la API en sí).
   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
5. Comandos disponibles dentro de `api/`:
   ```powershell
   npm run start:dev    # servidor en modo desarrollo (http://localhost:3000)
   npm run seed:admin   # crea el primer admin (lee SEED_ADMIN_NOMBRE/CORREO del .env)
   npm run seed:demo    # datos de ejemplo para la demo/el panel de admin (ver abajo)
   npm run db:backup                     # respaldo de la base de desarrollo (backups/, nunca se versiona)
   npm run db:restore -- <archivo>       # restaura un respaldo (sin --confirm solo muestra qué haría)
   npm run lint          # ESLint
   npm test              # pruebas unitarias (Jest)
   npm run test:e2e      # pruebas end-to-end (Jest + supertest); necesita api/.env.test, ver abajo
   npm run build          # compilar a dist/
   ```
   Con `SWAGGER_ENABLED=true` en `api/.env`, la documentación queda en
   `http://localhost:3000/api/docs`.

### Con Docker

Alternativa opcional a MySQL nativo + Mailpit ejecutable: `infra/docker-compose.yml`
levanta ambos en contenedores, expuestos en los mismos puertos
(`127.0.0.1:3306` y `127.0.0.1:8025`/`127.0.0.1:1025`), así que el resto de
esta guía (configurar `api/.env`, correr la API, etc.) no cambia.

1. Copia `infra/.env.example` a `infra/.env` y genera un valor real para
   `MYSQL_ROOT_PASSWORD`:
   ```powershell
   node -e "console.log(require('crypto').randomBytes(24).toString('base64'))"
   ```
2. Levanta MySQL y Mailpit:
   ```powershell
   docker compose -f infra/docker-compose.yml --env-file infra/.env up -d
   ```
3. Carga el esquema y crea `clicksafe_api` igual que en el paso 2 de arriba,
   pero vía `docker exec`:
   ```powershell
   Get-Content database/clicksafe_db.sql | docker exec -i clicksafe-mysql mysql -uroot -p<MYSQL_ROOT_PASSWORD>
   docker exec -i clicksafe-mysql mysql -uroot -p<MYSQL_ROOT_PASSWORD> -e "CREATE USER IF NOT EXISTS 'clicksafe_api'@'%' IDENTIFIED BY '...'; -- mismos GRANT de arriba, con @'%' en vez de @'127.0.0.1'"
   ```
   `npm run db:backup`/`npm run db:restore` están pensados para mysqldump/mysql
   nativos (`MYSQLDUMP_PATH`/`MYSQL_PATH`); con Docker, usa en su lugar
   `docker exec clicksafe-mysql mysqldump ...`/`docker exec -i clicksafe-mysql mysql ...`
   directamente.

### Datos de ejemplo (`npm run seed:demo`)

Crea, contra la base de **desarrollo** (nunca contra producción: se niega a
correr si `NODE_ENV=production`), más de 20 usuarios normales con correo ya
verificado (uno de ellos queda suspendido, para probar el panel con un
usuario inactivo) y unos 25 reportes repartidos en los 3 estados, en varias
plataformas (incluida "Otra") y categorías, con fechas distribuidas en los
últimos 12 meses, algunos anónimos, varios con evidencias (imágenes simples
generadas con `sharp`, guardadas con el mismo `StorageService` que usa la
API real), comentarios, likes, y un comentario oculto automáticamente por 3
denuncias. Incluye además dos reportes pensados para probar el panel de
administrador: uno con el título `<img src=x onerror=alert(1)>` (confirma
que el panel nunca lo interpreta como HTML) y otro con la URL
`https://mercadolibre.com.mx@estafa.example` (confirma que el panel no lo
muestra como si fuera un enlace legítimo a Mercado Libre; la API pública
rechazaría esa URL si viniera de un reporte real, sección 4.8).

También crea un reporte dedicado a moderación de comentarios (Fase 4), con
un comentario con 3 denuncias de motivos distintos (cada una con su
`detalle`) que llega a `oculto_auto`, uno con una sola denuncia todavía
pendiente, uno con el contenido `<img src=x onerror=alert(1)>` y uno con una
cadena de ~300 caracteres sin espacios (para probar el ajuste de texto del
panel).

Requiere que ya exista un admin (`npm run seed:admin` primero: las
revisiones de ejemplo quedan a su nombre) y además crea un **segundo admin**
de demo con contraseña aleatoria inutilizable (igual que `POST
/admin/admins`), para poder probar el panel con más de un admin. A
diferencia del resto del script, esto sí crea una cuenta con rol admin — una
excepción deliberada solo para esta herramienta de desarrollo, nunca
disponible por la API pública.

Es **idempotente por elemento**, no "todo o nada": cada usuario se busca por
`correo` y cada reporte por `titulo` exacto, así que correrlo varias veces
es seguro — solo crea lo que todavía falte (nunca borra ni modifica nada
existente) y al final imprime qué creó y qué ya existía. Las contraseñas de
los usuarios recién creados solo se muestran esa vez, en la consola.

## Base de datos para las pruebas e2e

`npm run test:e2e` corre contra una base **separada** de la de desarrollo:
`clicksafe_test`. Así las pruebas nunca escriben usuarios ni datos de
prueba en `clicksafe_db`, y nunca pueden borrar algo que sí te importa.

1. Crea la base `clicksafe_test` con el mismo esquema que `clicksafe_db`,
   sin modificar `database/clicksafe_db.sql` (ese archivo ya fue probado y
   siempre crea literalmente `clicksafe_db`): sustituye el nombre solo al
   cargarlo.
   ```powershell
   # Con MySQL accesible directamente (sin Docker):
   (Get-Content database/clicksafe_db.sql) -replace 'clicksafe_db', 'clicksafe_test' | mysql -uroot -p

   # Con el MySQL de infra/docker-compose.yml:
   (Get-Content database/clicksafe_db.sql) -replace 'clicksafe_db', 'clicksafe_test' | docker exec -i clicksafe-mysql mysql -uroot -p<MYSQL_ROOT_PASSWORD>
   ```
   Si usas un cliente gráfico (Workbench, DataGrip, etc.) sin soporte para
   tuberías: guarda una copia de `database/clicksafe_db.sql` con `clicksafe_db`
   reemplazado por `clicksafe_test` y ejecútala ahí; la copia no se versiona
   (no la guardes dentro del repo).
2. Crea un usuario **dedicado** a esta base, `clicksafe_api_test`, con los
   mismos permisos mínimos que `clicksafe_api` tiene sobre `clicksafe_db`
   (sección 4 arriba) pero apuntando a `clicksafe_test`. Usa una contraseña
   distinta a la de `clicksafe_api`: si esta se filtra (por ejemplo, en un
   entorno de CI menos cuidado), no debe servir para nada contra la base real.

   El host del usuario depende de cómo corre tu MySQL: `'%'` (cualquier
   host) solo tiene sentido si MySQL corre en un contenedor Docker al que
   te conectas desde fuera (como en `infra/docker-compose.yml`). Si tienes
   MySQL instalado localmente en Windows y la API se conecta a
   `127.0.0.1`, el usuario debe crearse como `'clicksafe_api_test'@'127.0.0.1'`
   (igual aplica a `clicksafe_api` en el paso 4, si tu instalación es local).
   ```powershell
   mysql -uroot -p -e "
   CREATE USER IF NOT EXISTS 'clicksafe_api_test'@'127.0.0.1' IDENTIFIED BY '<contraseña distinta a la de clicksafe_api>';
   GRANT SELECT, INSERT, UPDATE ON clicksafe_test.Usuario TO 'clicksafe_api_test'@'127.0.0.1';
   GRANT SELECT, INSERT, UPDATE ON clicksafe_test.Plataforma TO 'clicksafe_api_test'@'127.0.0.1';
   GRANT SELECT, INSERT, UPDATE ON clicksafe_test.Categoria_fraude TO 'clicksafe_api_test'@'127.0.0.1';
   GRANT SELECT, INSERT, DELETE ON clicksafe_test.Captcha_usado TO 'clicksafe_api_test'@'127.0.0.1';
   GRANT SELECT, INSERT, UPDATE, DELETE ON clicksafe_test.Sesion TO 'clicksafe_api_test'@'127.0.0.1';
   GRANT SELECT, INSERT, UPDATE, DELETE ON clicksafe_test.Token_verificacion TO 'clicksafe_api_test'@'127.0.0.1';
   GRANT SELECT, INSERT ON clicksafe_test.Bitacora_auditoria TO 'clicksafe_api_test'@'127.0.0.1';
   GRANT SELECT, INSERT, UPDATE, DELETE ON clicksafe_test.Reporte TO 'clicksafe_api_test'@'127.0.0.1';
   GRANT SELECT, INSERT, DELETE ON clicksafe_test.Evidencia TO 'clicksafe_api_test'@'127.0.0.1';
   GRANT SELECT, INSERT ON clicksafe_test.Revision_reporte TO 'clicksafe_api_test'@'127.0.0.1';
   GRANT SELECT, INSERT, DELETE ON clicksafe_test.Like_reporte TO 'clicksafe_api_test'@'127.0.0.1';
   GRANT SELECT, INSERT, UPDATE ON clicksafe_test.Comentario TO 'clicksafe_api_test'@'127.0.0.1';
   GRANT SELECT, INSERT, UPDATE ON clicksafe_test.Denuncia_comentario TO 'clicksafe_api_test'@'127.0.0.1';
   GRANT SELECT, INSERT, UPDATE, DELETE ON clicksafe_test.Notificacion TO 'clicksafe_api_test'@'127.0.0.1';
   FLUSH PRIVILEGES;"
   ```
   (si usas Docker, antepón `docker exec -i clicksafe-mysql` igual que en el paso 4).
3. Dentro de `api/`:
   ```powershell
   Copy-Item .env.test.example .env.test
   ```
   Edita `api/.env.test`: genera valores propios para los secretos (no
   reutilices los de `api/.env`) y pon en `DB_PASSWORD` la contraseña de
   `clicksafe_api_test` del paso 2. **`DB_NAME` debe quedar exactamente en
   `clicksafe_test`** — si no, la API se niega a arrancar al correr las
   pruebas (es a propósito, ver `src/config/env.schema.ts`).
4. Corre las pruebas:
   ```powershell
   npm run test:e2e
   ```
   Antes de que Jest arranque, `npm run pretest:e2e` (automático) revisa que
   `api/.env.test` exista y apunte a `clicksafe_test`; si no, falla de
   inmediato con un mensaje claro, sin intentar conectarse a ninguna base.

## Integración continua

En cada pull request hacia `main`, GitHub Actions
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) corre, dentro de
`api/`: `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run
build` y `npm audit --audit-level=high`. El análisis estático (CodeQL) corre
por separado, vía el *default setup* de GitHub (no un workflow propio: ya
viene activado a nivel del repositorio, así que agregar uno duplicaría el
análisis). [`.github/dependabot.yml`](.github/dependabot.yml) mantiene al
día las dependencias de npm y de las propias GitHub Actions.

Las pruebas e2e (`npm run test:e2e`) necesitan una base MySQL real
(`clicksafe_test`) que este workflow no monta, así que siguen corriendo en
local antes de cada PR (ver la sección de arriba).

## Despliegue en el laboratorio

> Esta sección es para una demo rápida en 3 PCs con **Windows**, sin Nginx
> ni TLS (HTTP plano dentro de la red del laboratorio). Es distinta de
> [`docs/despliegue.md`](docs/despliegue.md), que describe el despliegue
> "real" en dos PCs con Linux, Nginx y TLS propio.

1. **Mailpit primero, luego la API.** El registro de usuario envía un
   correo de verificación; si Mailpit no está corriendo, `POST
   /auth/register` responde 500. Arranca siempre Mailpit (`mailpit.exe
   --listen 127.0.0.1:8025 --smtp 127.0.0.1:1025`) antes que la API.
2. Dentro de `api/`, copia el ejemplo del laboratorio y rellénalo con
   secretos **nuevos** (no reutilices los de `api/.env` de desarrollo):
   ```powershell
   Copy-Item .env.lab.example .env.lab
   ```
   Genera cada secreto con
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
   y pon la IP real de la PC de base de datos, la contraseña de
   `clicksafe_api` y la ruta de `STORAGE_DIR` (créala si no existe).
3. Crea el primer admin, opcionalmente llena datos de ejemplo y arranca la
   API, los tres leyendo `.env.lab` con el `--env-file` nativo de Node (no
   requiere Docker ni cambiar `api/.env`):
   ```powershell
   npm run seed:admin:lab
   npm run seed:demo:lab   # opcional: usuarios y reportes de ejemplo,
                           # incluidos reportes pendientes de otro usuario
                           # para demostrar validar/rechazar desde el panel
   npm run start:lab
   ```
4. **Revisa que la hora de Windows coincida con la del celular.** El 2FA
   (TOTP) depende de que ambos relojes estén sincronizados; un desfase de
   más de un paso (30 s) hace que códigos válidos se rechacen.
5. **Al terminar la demo, borra `api/.env.lab`.** Contiene secretos reales
   en texto plano sobre una PC compartida del laboratorio; no debe quedar
   ahí después de que termine la sesión.

## Estado del proyecto

En desarrollo por fases (ver sección 9 de `CLAUDE.md`). Completadas: Fases
0-7 (base, seguridad, datos, auth, catálogos/reportes/evidencias/likes,
comentarios/denuncias/notificaciones, admin, calidad y entrega). Alcance
reducido en las Fases 4-6 por la fecha de entrega original — ver la nota al
inicio de la sección 7 de `CLAUDE.md` (varios de esos puntos pospuestos ya
se implementaron después, en ramas posteriores).
