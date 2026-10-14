# ClickSafe — Backend

API REST en NestJS para ClickSafe, una app para reportar publicaciones
sospechosas de fraude en tiendas en línea. Proyecto de la materia
*Integración de seguridad informática en redes y sistemas de software*
(Tec de Monterrey), en colaboración con Red por la Ciberseguridad.

> Este README es una versión inicial. La guía completa (seed del admin, cómo
> correr las pruebas de seguridad, etc.) se agrega en la Fase 7. El contexto
> completo del proyecto está en [CLAUDE.md](CLAUDE.md).

## Estructura del repositorio

```
/
├── database/    esquema SQL (clicksafe_db.sql)
├── infra/       docker-compose.yml (MySQL 8 + Mailpit) para desarrollo local
├── docs/        documentación técnica (se agrega en fases posteriores)
├── api/         API REST en NestJS
└── admin-web/   sitio web de administrador (fase posterior)
```

## Requisitos

- Node.js 22+ (recomendado 24)
- npm
- Docker Desktop (para MySQL y Mailpit en desarrollo)

## Poner en marcha el entorno de desarrollo

1. Copia `infra/.env.example` a `infra/.env` y genera un valor real para
   `MYSQL_ROOT_PASSWORD`:
   ```powershell
   node -e "console.log(require('crypto').randomBytes(24).toString('base64'))"
   ```
2. Levanta MySQL y Mailpit (si ya tienes otro MySQL corriendo en el puerto
   3306, deténlo primero o cambia el puerto publicado en
   `infra/docker-compose.yml`):
   ```powershell
   docker compose -f infra/docker-compose.yml --env-file infra/.env up -d
   ```
   - MySQL queda expuesto en `127.0.0.1:3306`.
   - Mailpit: interfaz web en `http://localhost:8025`, SMTP en `127.0.0.1:1025`.
3. Carga el esquema (crea la base `clicksafe_db`, sus tablas y los catálogos
   iniciales):
   ```powershell
   Get-Content database/clicksafe_db.sql | docker exec -i clicksafe-mysql mysql -uroot -p<MYSQL_ROOT_PASSWORD>
   ```
4. Crea el usuario de mínimo privilegio `clicksafe_api` (la API nunca se
   conecta como root). Los permisos exactos están comentados al final de
   `database/clicksafe_db.sql`; para desarrollo local (host `%` en vez de la
   subred de producción). El ejemplo asume el MySQL de
   `infra/docker-compose.yml`; si en cambio tienes MySQL instalado
   directamente en Windows (sin Docker) y la API se conecta a `127.0.0.1`,
   usa `'clicksafe_api'@'127.0.0.1'` en vez de `'clicksafe_api'@'%'` en
   cada línea (más restrictivo, y es el host real con el que MySQL ve
   llegar esa conexión):
   ```powershell
   docker exec -i clicksafe-mysql mysql -uroot -p<MYSQL_ROOT_PASSWORD> -e "
   CREATE USER IF NOT EXISTS 'clicksafe_api'@'%' IDENTIFIED BY '<igual a DB_PASSWORD en api/.env>';
   GRANT SELECT, INSERT, UPDATE ON clicksafe_db.Usuario TO 'clicksafe_api'@'%';
   GRANT SELECT, INSERT, UPDATE ON clicksafe_db.Plataforma TO 'clicksafe_api'@'%';
   GRANT SELECT, INSERT, UPDATE ON clicksafe_db.Categoria_fraude TO 'clicksafe_api'@'%';
   GRANT SELECT, INSERT, DELETE ON clicksafe_db.Captcha_usado TO 'clicksafe_api'@'%';
   GRANT SELECT, INSERT, UPDATE, DELETE ON clicksafe_db.Sesion TO 'clicksafe_api'@'%';
   GRANT SELECT, INSERT, UPDATE, DELETE ON clicksafe_db.Token_verificacion TO 'clicksafe_api'@'%';
   GRANT SELECT, INSERT ON clicksafe_db.Bitacora_auditoria TO 'clicksafe_api'@'%';
   GRANT SELECT, INSERT, UPDATE, DELETE ON clicksafe_db.Reporte TO 'clicksafe_api'@'%';
   GRANT SELECT, INSERT, DELETE ON clicksafe_db.Evidencia TO 'clicksafe_api'@'%';
   GRANT SELECT, INSERT ON clicksafe_db.Revision_reporte TO 'clicksafe_api'@'%';
   GRANT SELECT, INSERT, DELETE ON clicksafe_db.Like_reporte TO 'clicksafe_api'@'%';
   GRANT SELECT, INSERT, UPDATE ON clicksafe_db.Comentario TO 'clicksafe_api'@'%';
   GRANT SELECT, INSERT, UPDATE ON clicksafe_db.Denuncia_comentario TO 'clicksafe_api'@'%';
   GRANT SELECT, INSERT, UPDATE, DELETE ON clicksafe_db.Notificacion TO 'clicksafe_api'@'%';
   FLUSH PRIVILEGES;"
   ```
5. Instala las dependencias de la API y configura su `.env`:
   ```powershell
   cd api
   npm install
   Copy-Item .env.example .env
   ```
   Edita `api/.env`: genera un valor real para `JWT_ACCESS_SECRET` (mínimo
   32 caracteres) y pon en `DB_PASSWORD` la misma contraseña que usaste para
   `clicksafe_api` en el paso anterior.
   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
6. Comandos disponibles dentro de `api/`:
   ```powershell
   npm run start:dev    # servidor en modo desarrollo (http://localhost:3000)
   npm run seed:admin   # crea el primer admin (lee SEED_ADMIN_NOMBRE/CORREO del .env)
   npm run seed:demo    # datos de ejemplo para la demo/el panel de admin (ver abajo)
   npm run lint          # ESLint
   npm test              # pruebas unitarias (Jest)
   npm run test:e2e      # pruebas end-to-end (Jest + supertest); necesita api/.env.test, ver abajo
   npm run build          # compilar a dist/
   ```
   Con `SWAGGER_ENABLED=true` en `api/.env`, la documentación queda en
   `http://localhost:3000/api/docs`.

### Datos de ejemplo (`npm run seed:demo`)

Crea, contra la base de **desarrollo** (nunca contra producción: se niega a
correr si `NODE_ENV=production`), 3 usuarios normales con correo ya
verificado y unos 25 reportes repartidos en los 3 estados, en varias
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

Requiere que ya exista un admin (`npm run seed:admin` primero: las
revisiones de ejemplo quedan a su nombre; el script nunca crea un admin
nuevo).

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

## Estado del proyecto

En desarrollo por fases (ver sección 9 de `CLAUDE.md`). Completadas: Fases
0-6 (base, seguridad, datos, auth, catálogos/reportes/evidencias/likes,
comentarios/denuncias/notificaciones, admin). Alcance reducido en las
Fases 4-6 por la fecha de entrega — ver la nota al inicio de la sección 7
de `CLAUDE.md`. Falta la **Fase 7 — Calidad y entrega** (CI, CodeQL ya
agregado, `dependabot.yml`, más pruebas).
