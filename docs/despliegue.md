# Despliegue en el laboratorio

Guía paso a paso para la topología de prueba del curso: **dos PCs con
Linux** en la misma red, más los dispositivos de prueba (navegador,
simulador/iPhone, y las herramientas de pentest — nmap, Nessus, OWASP ZAP).

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  PC "backend" (Linux)       │        │  PC "base de datos" (Linux)   │
│                              │        │                                │
│  Nginx  :443 (TLS) ─┐       │        │  MySQL 8  :3306                │
│                      ▼       │  3306  │  (solo acepta la IP            │
│  API (NestJS) 127.0.0.1:3000│───────▶│   del backend)                 │
│  (nunca expuesta a la red)   │        │                                │
└─────────────────────────────┘        └──────────────────────────────┘
        ▲ 443
        │
  navegador / app iOS / ZAP / Nessus / nmap
```

Puertos que deben quedar **abiertos**:
- PC backend: **solo 443** (HTTPS). El 80 solo existe para redirigir a 443;
  si quieres ser aún más estricto, ni siquiera lo abras en el firewall —
  Nginx seguirá funcionando para quien ya entre por 443. El 3000 (la API)
  nunca se abre: la API escucha en `127.0.0.1`, inalcanzable desde fuera
  de esa PC aunque el firewall lo permitiera.
- PC de base de datos: **solo 3306**, y únicamente aceptando conexiones
  desde la IP de la PC del backend (ni siquiera desde el resto de la red).

---

## 1. PC de base de datos

1. Instala MySQL 8.0.16+ y copia `database/clicksafe_db.sql` a esa PC.
2. Carga el esquema (crea la base, tablas y catálogos iniciales):
   ```bash
   mysql -uroot -p < clicksafe_db.sql
   ```
3. Crea el usuario de mínimo privilegio **restringido a la IP del
   backend** (nunca `%`, nunca root para la API — sección 2 de
   `MANUAL.md`). Sustituye `IP_DEL_BACKEND` por la IP real de la otra PC:
   ```bash
   mysql -uroot -p -e "
   CREATE USER IF NOT EXISTS 'clicksafe_api'@'IP_DEL_BACKEND' IDENTIFIED BY '<contraseña generada>';
   GRANT SELECT, INSERT, UPDATE         ON clicksafe_db.Usuario             TO 'clicksafe_api'@'IP_DEL_BACKEND';
   GRANT SELECT, INSERT, UPDATE         ON clicksafe_db.Plataforma          TO 'clicksafe_api'@'IP_DEL_BACKEND';
   GRANT SELECT, INSERT, UPDATE         ON clicksafe_db.Categoria_fraude    TO 'clicksafe_api'@'IP_DEL_BACKEND';
   GRANT SELECT, INSERT, DELETE         ON clicksafe_db.Captcha_usado       TO 'clicksafe_api'@'IP_DEL_BACKEND';
   GRANT SELECT, INSERT, UPDATE, DELETE ON clicksafe_db.Sesion              TO 'clicksafe_api'@'IP_DEL_BACKEND';
   GRANT SELECT, INSERT, UPDATE, DELETE ON clicksafe_db.Token_verificacion  TO 'clicksafe_api'@'IP_DEL_BACKEND';
   GRANT SELECT, INSERT                 ON clicksafe_db.Bitacora_auditoria  TO 'clicksafe_api'@'IP_DEL_BACKEND';
   GRANT SELECT, INSERT, UPDATE, DELETE ON clicksafe_db.Reporte             TO 'clicksafe_api'@'IP_DEL_BACKEND';
   GRANT SELECT, INSERT, DELETE         ON clicksafe_db.Evidencia           TO 'clicksafe_api'@'IP_DEL_BACKEND';
   GRANT SELECT, INSERT                 ON clicksafe_db.Revision_reporte    TO 'clicksafe_api'@'IP_DEL_BACKEND';
   GRANT SELECT, INSERT, DELETE         ON clicksafe_db.Like_reporte        TO 'clicksafe_api'@'IP_DEL_BACKEND';
   GRANT SELECT, INSERT, UPDATE         ON clicksafe_db.Comentario          TO 'clicksafe_api'@'IP_DEL_BACKEND';
   GRANT SELECT, INSERT, UPDATE         ON clicksafe_db.Denuncia_comentario TO 'clicksafe_api'@'IP_DEL_BACKEND';
   GRANT SELECT, INSERT, UPDATE, DELETE ON clicksafe_db.Notificacion        TO 'clicksafe_api'@'IP_DEL_BACKEND';
   FLUSH PRIVILEGES;"
   ```
4. Haz que MySQL escuche en la IP de esta PC, no solo en localhost
   (`bind-address` en `/etc/mysql/mysql.conf.d/mysqld.cnf`), y abre el
   firewall **solo** para 3306 desde la IP del backend:
   ```bash
   sudo ufw allow from IP_DEL_BACKEND to any port 3306 proto tcp
   sudo ufw enable
   ```

## 2. PC del backend — API

1. Instala Node.js 22+ (recomendado 24) y clona el repositorio.
2. Dentro de `api/`:
   ```bash
   npm ci
   npm run build
   ```
3. Crea un usuario de sistema **sin privilegios** y sin shell de login
   para correr el servicio (nunca root):
   ```bash
   sudo useradd --system --no-create-home --shell /usr/sbin/nologin clicksafe
   sudo mkdir -p /opt/clicksafe/api /var/lib/clicksafe/storage /etc/clicksafe
   sudo cp -r api/dist api/node_modules api/package.json /opt/clicksafe/api/
   sudo chown -R clicksafe:clicksafe /opt/clicksafe /var/lib/clicksafe/storage
   ```
4. Copia `api/.env.production.example` a `/etc/clicksafe/api.env` y
   complétalo: `DB_HOST` con la IP de la PC de base de datos, todos los
   secretos generados de nuevo (nunca reutilices los de desarrollo), y
   `DB_PASSWORD` con la contraseña que le diste a `clicksafe_api` en el
   paso anterior.
   ```bash
   sudo chown clicksafe:clicksafe /etc/clicksafe/api.env
   sudo chmod 600 /etc/clicksafe/api.env
   ```
5. Corre el seed del primer admin **una sola vez**, con las mismas
   variables de entorno que usará el servicio — `systemd-run` reutiliza el
   mismo cargador de `EnvironmentFile` que el `.service` (sección 6), así
   que nunca pasa por una re-interpretación de shell que rompa valores con
   espacios o `<`/`>` como `MAIL_FROM`:
   ```bash
   sudo systemd-run --uid=clicksafe --gid=clicksafe \
     --working-directory=/opt/clicksafe/api \
     --property="EnvironmentFile=/etc/clicksafe/api.env" \
     --wait --pipe \
     node dist/scripts/seed-admin.js
   ```
   (`nest build` compila `scripts/` junto con `src/`, así que
   `dist/scripts/seed-admin.js` existe sin pasos extra.) Guarda la
   contraseña que imprime: solo se muestra esa vez.
6. Instala el servicio systemd:
   ```bash
   sudo cp infra/systemd/clicksafe-api.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now clicksafe-api
   sudo systemctl status clicksafe-api
   ```
   La API ahora escucha SOLO en `127.0.0.1:3000` (`NODE_ENV=production`
   en `src/main.ts`) — confírmalo con `ss -tlnp | grep 3000`: no debe
   aparecer en ninguna IP que no sea `127.0.0.1`.

## 3. PC del backend — certificado TLS propio

1. En tu máquina (no en el servidor), genera la CA y el certificado:
   ```bash
   cd infra/pki
   SERVER_IP=<IP_DEL_BACKEND> ./generate-ca.sh
   ```
2. Copia `fullchain.pem` y `clicksafe.key` al servidor:
   ```bash
   sudo mkdir -p /etc/nginx/ssl/clicksafe
   sudo cp out/fullchain.pem out/clicksafe.key /etc/nginx/ssl/clicksafe/
   sudo chmod 600 /etc/nginx/ssl/clicksafe/clicksafe.key
   ```
3. **Instala la CA (`clicksafe-ca.pem`) como de confianza** en cada
   dispositivo de prueba — sin esto, el navegador/la app verán un error
   de certificado no confiable (correcto: es una CA propia, no una
   pública):
   - **Simulador de iOS**: arrastra `clicksafe-ca.pem` a la ventana del
     simulador (lo instala como perfil). Luego: *Ajustes → General → VPN
     y administración de dispositivos* para confiar en el perfil, y
     *Ajustes → General → Acerca de → Confianza de certificados* para
     activar la confianza total en esa CA.
   - **iPhone físico**: manda `clicksafe-ca.pem` por AirDrop/correo, ábrelo
     para instalar el perfil, y repite los mismos dos pasos de arriba
     (instalar perfil + activar confianza total) — iOS nunca confía en un
     certificado nuevo con solo instalarlo.
   - **macOS (Safari/Chrome)**: doble clic en `clicksafe-ca.pem` para
     abrir Llavero, busca "ClickSafe Lab Root CA", edítalo y pon
     "Confiar siempre" en "Usar este certificado".
   - **Windows (Chrome/Edge)**: `certutil -addstore -f "Root" clicksafe-ca.pem`
     (como administrador), o impórtalo desde `certmgr.msc` en
     "Entidades de certificación raíz de confianza".
4. Instala y configura Nginx:
   ```bash
   sudo apt install nginx
   sudo cp infra/nginx/clicksafe.conf /etc/nginx/sites-available/clicksafe.conf
   # Reemplaza CLICKSAFE_SERVER_NAME por el nombre/IP real:
   sudo sed -i "s/CLICKSAFE_SERVER_NAME/<IP_O_NOMBRE_DEL_BACKEND>/" /etc/nginx/sites-available/clicksafe.conf
   sudo ln -s /etc/nginx/sites-available/clicksafe.conf /etc/nginx/sites-enabled/
   sudo rm -f /etc/nginx/sites-enabled/default
   sudo nginx -t
   sudo systemctl reload nginx
   ```
5. Abre el firewall solo para 443 (y opcionalmente 80, solo para la
   redirección):
   ```bash
   sudo ufw allow 443/tcp
   sudo ufw enable
   ```

## 4. Verificación

```bash
curl --cacert infra/pki/out/clicksafe-ca.pem https://<IP_O_NOMBRE_DEL_BACKEND>/api/v1/health
# {"status":"ok"}
```

Si responde eso usando `--cacert` (en vez de `-k`/`--insecure`), el
certificado propio está bien instalado y la cadena de confianza es
correcta — así es como lo verá la app iOS y como lo verán las
herramientas de pentest una vez que les instales la misma CA.

Para OWASP ZAP/Nessus/nmap contra esta instalación: apunta a
`https://<IP_DEL_BACKEND>/` (puerto 443). Instalar `clicksafe-ca.pem` en
la máquina que corre ZAP evita ruido de "certificado no confiable" que no
es una vulnerabilidad real de la app, sino del certificado propio del
laboratorio.
