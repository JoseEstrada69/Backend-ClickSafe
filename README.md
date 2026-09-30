# ClickSafe — Backend

API REST en NestJS para ClickSafe, una app para reportar publicaciones
sospechosas de fraude en tiendas en línea. Proyecto de la materia
*Integración de seguridad informática en redes y sistemas de software*
(Tec de Monterrey), en colaboración con Red por la Ciberseguridad.

> Este README es la versión inicial (Fase 0). La guía completa (variables de
> entorno, seed del admin, cómo correr las pruebas, etc.) se agrega en la
> Fase 7. El contexto completo del proyecto está en [CLAUDE.md](CLAUDE.md).

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
2. Levanta MySQL y Mailpit:
   ```powershell
   docker compose -f infra/docker-compose.yml --env-file infra/.env up -d
   ```
   - MySQL queda expuesto en `127.0.0.1:3306`.
   - Mailpit: interfaz web en `http://localhost:8025`, SMTP en `127.0.0.1:1025`.
3. Instala las dependencias de la API:
   ```powershell
   cd api
   npm install
   ```
4. Comandos disponibles dentro de `api/`:
   ```powershell
   npm run start:dev   # servidor en modo desarrollo
   npm run lint         # ESLint
   npm test             # pruebas unitarias (Jest)
   npm run test:e2e     # pruebas end-to-end (Jest + supertest)
   npm run build         # compilar a dist/
   ```

## Estado del proyecto

En desarrollo por fases (ver sección 9 de `CLAUDE.md`). Actualmente: **Fase 0
— Base del repo**.
