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
   subred de producción):
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
   npm run lint          # ESLint
   npm test              # pruebas unitarias (Jest)
   npm run test:e2e      # pruebas end-to-end (Jest + supertest)
   npm run build          # compilar a dist/
   ```
   Con `SWAGGER_ENABLED=true` en `api/.env`, la documentación queda en
   `http://localhost:3000/api/docs`.

## Estado del proyecto

En desarrollo por fases (ver sección 9 de `CLAUDE.md`). Actualmente: **Fase 2
— Datos y servicios base**.
