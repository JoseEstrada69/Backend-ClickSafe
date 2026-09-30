-- =====================================================================
--  ClickSafe — Esquema de base de datos  (v2.1)
--  Motor: MySQL 8.0.16 o superior (necesario para que los CHECK se apliquen)
--  Objetivo de seguridad: OWASP ASVS nivel 2
-- =====================================================================
--  Convenciones generales
--   * Todas las fechas se guardan en UTC. La API fija la zona horaria de
--     la conexión en '+00:00' y la app convierte a hora local al mostrar.
--   * Ningún token (sesión, verificación de correo, recuperación) se guarda
--     en claro: solo su hash SHA-256. Si roban la BD, los tokens no sirven.
--   * Los usuarios NO se borran físicamente: se desactivan (activo = FALSE).
--     Así no se pierde la trazabilidad de reportes, revisiones y bitácora.
--   * Los valores permitidos de columnas tipo "estado" se fuerzan con CHECK,
--     además de validarse en la API (defensa en profundidad).
-- =====================================================================

-- ADVERTENCIA: la siguiente línea elimina toda la base. Solo en desarrollo.
DROP DATABASE IF EXISTS clicksafe_db;
CREATE DATABASE clicksafe_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE clicksafe_db;


-- =====================================================================
-- 1. TABLAS INDEPENDIENTES
-- =====================================================================

-- ---------------------------------------------------------------------
-- Usuario
-- CAMBIOS:
--  - Se elimina password_salt: Argon2id genera un salt aleatorio y lo guarda
--    DENTRO del propio hash ($argon2id$v=19$m=...,t=...,p=...$<salt>$<hash>).
--  - correo pasa a VARCHAR(254), el máximo práctico según los RFC de correo.
--    La colación _ci hace que el UNIQUE no distinga mayúsculas.
--  - correo_verificado: no se permite iniciar sesión sin verificar.
--  - intentos_fallidos / bloqueado_hasta: bloqueo progresivo contra
--    fuerza bruta y credential stuffing (ASVS: control anti-automatización).
--  - totp_secreto: secreto 2FA de admins, CIFRADO con AES-256-GCM en la API
--    (formato iv:tag:cifrado en base64). Nunca en claro.
--  - totp_ultimo_contador: impide reutilizar el mismo código TOTP dentro de
--    su ventana de 30 s (ASVS exige que un OTP sea de un solo uso).
--  - CHECK de rol: la BD rechaza cualquier rol que no sea usuario/admin.
-- ---------------------------------------------------------------------
CREATE TABLE Usuario (
    id_usuario            INT AUTO_INCREMENT,
    nombre                VARCHAR(100)    NOT NULL,
    correo                VARCHAR(254)    NOT NULL,
    correo_verificado     BOOLEAN         NOT NULL DEFAULT FALSE,
    password_hash         VARCHAR(255)    NOT NULL,
    rol                   VARCHAR(20)     NOT NULL DEFAULT 'usuario',
    activo                BOOLEAN         NOT NULL DEFAULT TRUE,
    intentos_fallidos     SMALLINT        NOT NULL DEFAULT 0,
    bloqueado_hasta       DATETIME        NULL,
    totp_secreto          VARCHAR(255)    NULL,
    totp_activo           BOOLEAN         NOT NULL DEFAULT FALSE,
    totp_ultimo_contador  BIGINT          NULL,
    fecha_registro        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT pk_usuario        PRIMARY KEY (id_usuario),
    CONSTRAINT uq_usuario_correo UNIQUE (correo),
    CONSTRAINT ck_usuario_rol    CHECK (rol IN ('usuario', 'admin')),
    CONSTRAINT ck_usuario_intentos CHECK (intentos_fallidos >= 0),
    CONSTRAINT ck_usuario_totp   CHECK (totp_activo = FALSE OR totp_secreto IS NOT NULL)
);

-- ---------------------------------------------------------------------
-- Plataforma
-- CAMBIO: es_otra marca el registro "Otra". Cuando un reporte usa esa
-- plataforma, la API exige Reporte.plataforma_otra (nombre escrito por el
-- usuario). El dashboard agrupa todos esos casos como "Otra".
-- ---------------------------------------------------------------------
CREATE TABLE Plataforma (
    id_plataforma  INT AUTO_INCREMENT,
    nombre         VARCHAR(100) NOT NULL,
    es_otra        BOOLEAN      NOT NULL DEFAULT FALSE,
    activa         BOOLEAN      NOT NULL DEFAULT TRUE,

    CONSTRAINT pk_plataforma        PRIMARY KEY (id_plataforma),
    CONSTRAINT uq_plataforma_nombre UNIQUE (nombre)
);

-- ---------------------------------------------------------------------
-- Categoria_fraude (sin cambios)
-- ---------------------------------------------------------------------
CREATE TABLE Categoria_fraude (
    id_categoria  INT AUTO_INCREMENT,
    nombre        VARCHAR(100) NOT NULL,
    descripcion   VARCHAR(255) NULL,
    activa        BOOLEAN      NOT NULL DEFAULT TRUE,

    CONSTRAINT pk_categoria_fraude  PRIMARY KEY (id_categoria),
    CONSTRAINT uq_categoria_nombre  UNIQUE (nombre)
);

-- ---------------------------------------------------------------------
-- Captcha_usado  (NUEVA)
-- Guarda la firma de cada reto proof-of-work ya resuelto para que no pueda
-- reutilizarse (ataque de repetición / replay). La API borra periódicamente
-- los registros expirados.
-- ---------------------------------------------------------------------
CREATE TABLE Captcha_usado (
    firma      CHAR(64)  NOT NULL,
    expira_en  DATETIME  NOT NULL,

    CONSTRAINT pk_captcha_usado PRIMARY KEY (firma),
    INDEX idx_captcha_expira (expira_en)
);


-- =====================================================================
-- 2. TABLAS QUE DEPENDEN DE USUARIO
-- =====================================================================

-- ---------------------------------------------------------------------
-- Sesion  (NUEVA)
-- Cada fila es un refresh token. Se aplica ROTACIÓN con DETECCIÓN DE REUSO:
--  - Cada vez que se usa un refresh token, se marca reemplazada_en y se
--    emite uno nuevo con la misma "familia".
--  - Si alguien presenta un token que YA fue reemplazado, significa que fue
--    robado (o el ladrón o la víctima lo usó antes): se revoca toda la
--    familia y ambos tienen que volver a iniciar sesión.
--  - expira_absoluta: límite máximo de vida de la sesión aunque se siga
--    refrescando (ASVS: timeout absoluto de sesión).
--  - token_hash es SHA-256 y no Argon2 porque el token es aleatorio de
--    256 bits: no se puede adivinar por fuerza bruta, y SHA-256 permite
--    buscarlo por índice.
-- ---------------------------------------------------------------------
CREATE TABLE Sesion (
    id_sesion        INT AUTO_INCREMENT,
    id_usuario       INT          NOT NULL,
    familia          CHAR(36)     NOT NULL,
    token_hash       CHAR(64)     NOT NULL,
    expira_en        DATETIME     NOT NULL,
    expira_absoluta  DATETIME     NOT NULL,
    reemplazada_en   DATETIME     NULL,
    revocada_en      DATETIME     NULL,
    ip               VARCHAR(45)  NULL,   -- 45 = longitud máxima de IPv6
    user_agent       VARCHAR(255) NULL,
    fecha_creacion   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_sesion            PRIMARY KEY (id_sesion),
    CONSTRAINT uq_sesion_token_hash UNIQUE (token_hash),
    CONSTRAINT fk_sesion_usuario    FOREIGN KEY (id_usuario)
        REFERENCES Usuario(id_usuario) ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_sesion_familia (familia),
    INDEX idx_sesion_usuario (id_usuario, revocada_en)
);

-- ---------------------------------------------------------------------
-- Token_verificacion  (NUEVA)
-- Códigos de un solo uso para verificar correo y recuperar contraseña.
-- El usuario recibe un código numérico en su correo y lo escribe en la app.
--  - Se guarda HMAC-SHA256(clave_servidor, id_usuario:tipo:código), no el
--    código. Un código de 6-8 dígitos tiene pocas combinaciones: con un
--    SHA-256 simple, quien robara la BD lo adivinaría en milisegundos. Con
--    HMAC necesita además la clave secreta, que NO vive en la BD.
--    Incluir id_usuario evita que dos usuarios con el mismo código generen
--    el mismo hash (y choquen con el UNIQUE).
--  - intentos: tras 5 códigos incorrectos el token se invalida (evita
--    adivinar el código por fuerza bruta en línea).
--  - usado_en impide reutilizarlo; expira_en limita su vida
--    (15 min recuperación, 30 min verificación).
-- ---------------------------------------------------------------------
CREATE TABLE Token_verificacion (
    id_token        INT AUTO_INCREMENT,
    id_usuario      INT          NOT NULL,
    tipo            VARCHAR(30)  NOT NULL,
    token_hash      CHAR(64)     NOT NULL,
    intentos        SMALLINT     NOT NULL DEFAULT 0,
    expira_en       DATETIME     NOT NULL,
    usado_en        DATETIME     NULL,
    fecha_creacion  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_token_verificacion PRIMARY KEY (id_token),
    CONSTRAINT uq_token_hash         UNIQUE (token_hash),
    CONSTRAINT ck_token_tipo         CHECK (tipo IN ('verificacion_correo', 'recuperacion_password')),
    CONSTRAINT ck_token_intentos     CHECK (intentos >= 0),
    CONSTRAINT fk_token_usuario      FOREIGN KEY (id_usuario)
        REFERENCES Usuario(id_usuario) ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_token_usuario_tipo (id_usuario, tipo)
);

-- ---------------------------------------------------------------------
-- Bitacora_auditoria  (NUEVA)
-- Registro de eventos de seguridad (ASVS cap. de logging): inicios de sesión
-- exitosos y fallidos, bloqueos, cambios de contraseña, activación de 2FA,
-- decisiones de admins, creación de admins, suspensiones, etc.
--  - id_usuario es NULL cuando el evento no tiene usuario identificado
--    (p. ej. login fallido con un correo inexistente).
--  - detalle NUNCA debe contener contraseñas, tokens ni secretos.
--  - El usuario de BD de la API solo tiene SELECT e INSERT aquí (ver el
--    final del script): aunque un atacante lograra una inyección SQL, no
--    podría borrar ni alterar el rastro de lo que hizo.
-- ---------------------------------------------------------------------
CREATE TABLE Bitacora_auditoria (
    id_evento     BIGINT AUTO_INCREMENT,
    fecha         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    id_usuario    INT          NULL,
    accion        VARCHAR(60)  NOT NULL,
    resultado     VARCHAR(10)  NOT NULL,
    recurso_tipo  VARCHAR(30)  NULL,
    recurso_id    INT          NULL,
    ip            VARCHAR(45)  NULL,
    user_agent    VARCHAR(255) NULL,
    detalle       JSON         NULL,

    CONSTRAINT pk_bitacora           PRIMARY KEY (id_evento),
    CONSTRAINT ck_bitacora_resultado CHECK (resultado IN ('exito', 'fallo')),
    CONSTRAINT fk_bitacora_usuario   FOREIGN KEY (id_usuario)
        REFERENCES Usuario(id_usuario) ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_bitacora_fecha  (fecha),
    INDEX idx_bitacora_accion (accion, fecha),
    INDEX idx_bitacora_usuario (id_usuario, fecha)
);


-- =====================================================================
-- 3. REPORTE
-- CAMBIOS:
--  - url_publicacion: el dato central del reporte. El CHECK obliga a que
--    empiece con http:// o https://, bloqueando esquemas peligrosos como
--    javascript: o data: aunque fallara la validación de la API.
--    IMPORTANTE: el servidor NUNCA visita esta URL (prevención de SSRF).
--  - plataforma_otra: nombre de la tienda cuando se elige "Otra".
--  - total_likes: contador desnormalizado para ordenar el feed sin contar
--    filas en cada petición. Se actualiza en la MISMA transacción que
--    inserta/borra en Like_reporte.
--  - fk usuario pasa a RESTRICT: los usuarios se desactivan, no se borran.
--  - Índices para el feed (por fecha y por likes) y la cola de revisión.
-- =====================================================================
CREATE TABLE Reporte (
    id_reporte           INT AUTO_INCREMENT,
    id_usuario           INT            NOT NULL,
    id_plataforma        INT            NOT NULL,
    plataforma_otra      VARCHAR(100)   NULL,
    id_categoria         INT            NOT NULL,
    titulo               VARCHAR(150)   NOT NULL,
    descripcion          TEXT           NOT NULL,
    url_publicacion      VARCHAR(2048)  NOT NULL,
    anonimo              BOOLEAN        NOT NULL DEFAULT FALSE,
    estado               VARCHAR(20)    NOT NULL DEFAULT 'pendiente',
    total_likes          INT            NOT NULL DEFAULT 0,
    fecha_creacion       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT pk_reporte          PRIMARY KEY (id_reporte),
    CONSTRAINT ck_reporte_estado   CHECK (estado IN ('pendiente', 'validado', 'rechazado')),
    CONSTRAINT ck_reporte_url      CHECK (url_publicacion LIKE 'http://%' OR url_publicacion LIKE 'https://%'),
    CONSTRAINT ck_reporte_likes    CHECK (total_likes >= 0),
    CONSTRAINT fk_reporte_usuario  FOREIGN KEY (id_usuario)
        REFERENCES Usuario(id_usuario) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_reporte_plataforma FOREIGN KEY (id_plataforma)
        REFERENCES Plataforma(id_plataforma) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_reporte_categoria FOREIGN KEY (id_categoria)
        REFERENCES Categoria_fraude(id_categoria) ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_reporte_fecha  (fecha_creacion),
    INDEX idx_reporte_likes  (total_likes, fecha_creacion),
    INDEX idx_reporte_estado (estado, fecha_creacion)
);


-- =====================================================================
-- 4. TABLAS QUE DEPENDEN DE REPORTE
-- =====================================================================

-- ---------------------------------------------------------------------
-- Evidencia
-- CAMBIOS:
--  - nombre_archivo ahora es un nombre ALEATORIO generado por la API
--    (UUID + extensión). El nombre original que manda el usuario no se
--    guarda: puede contener datos personales o caracteres para ataques de
--    path traversal (../../) o XSS.
--  - ruta_archivo es una clave RELATIVA dentro del almacenamiento
--    (p. ej. evidencias/2026/09/<uuid>.webp), nunca una ruta absoluta del
--    servidor. Así se puede migrar a MinIO sin tocar la BD.
--  - tipo_archivo solo acepta imágenes, validadas por sus bytes reales.
--  - tamano_bytes con límite de 5 MB forzado también en la BD.
--  - hash_sha256: integridad del archivo (detectar alteraciones en disco).
-- ---------------------------------------------------------------------
CREATE TABLE Evidencia (
    id_evidencia    INT AUTO_INCREMENT,
    id_reporte      INT           NOT NULL,
    nombre_archivo  VARCHAR(64)   NOT NULL,
    ruta_archivo    VARCHAR(500)  NOT NULL,
    tipo_archivo    VARCHAR(50)   NOT NULL,
    tamano_bytes    INT           NOT NULL,
    hash_sha256     CHAR(64)      NOT NULL,
    fecha_subida    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_evidencia          PRIMARY KEY (id_evidencia),
    CONSTRAINT uq_evidencia_nombre   UNIQUE (nombre_archivo),
    CONSTRAINT ck_evidencia_tipo     CHECK (tipo_archivo IN ('image/jpeg', 'image/png', 'image/webp')),
    CONSTRAINT ck_evidencia_tamano   CHECK (tamano_bytes > 0 AND tamano_bytes <= 5242880),
    CONSTRAINT fk_evidencia_reporte  FOREIGN KEY (id_reporte)
        REFERENCES Reporte(id_reporte) ON DELETE CASCADE ON UPDATE CASCADE
);

-- ---------------------------------------------------------------------
-- Revision_reporte
-- CAMBIOS:
--  - CHECK de decision.
--  - fk administrador pasa de CASCADE a RESTRICT: con CASCADE, borrar a un
--    admin borraba también el historial de todo lo que revisó, lo que
--    destruiría evidencia de auditoría.
-- ---------------------------------------------------------------------
CREATE TABLE Revision_reporte (
    id_revision       INT AUTO_INCREMENT,
    id_reporte        INT           NOT NULL,
    id_administrador  INT           NOT NULL,
    decision          VARCHAR(20)   NOT NULL,
    comentario        VARCHAR(500)  NULL,
    fecha_revision    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_revision_reporte      PRIMARY KEY (id_revision),
    CONSTRAINT ck_revision_decision     CHECK (decision IN ('validado', 'rechazado')),
    CONSTRAINT fk_revision_reporte      FOREIGN KEY (id_reporte)
        REFERENCES Reporte(id_reporte) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_revision_administrador FOREIGN KEY (id_administrador)
        REFERENCES Usuario(id_usuario) ON DELETE RESTRICT ON UPDATE CASCADE
);

-- ---------------------------------------------------------------------
-- Like_reporte  (NUEVA)
-- Se llama Like_reporte y no "Like" porque LIKE es palabra reservada de SQL.
-- La PRIMARY KEY compuesta (id_usuario, id_reporte) hace que la propia BD
-- impida dos likes del mismo usuario al mismo reporte, incluso si llegan
-- dos peticiones simultáneas (race condition) que la API no alcanzara a
-- detectar.
-- ---------------------------------------------------------------------
CREATE TABLE Like_reporte (
    id_usuario  INT       NOT NULL,
    id_reporte  INT       NOT NULL,
    fecha_like  DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_like_reporte     PRIMARY KEY (id_usuario, id_reporte),
    CONSTRAINT fk_like_usuario     FOREIGN KEY (id_usuario)
        REFERENCES Usuario(id_usuario) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_like_reporte     FOREIGN KEY (id_reporte)
        REFERENCES Reporte(id_reporte) ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_like_reporte (id_reporte)
);

-- ---------------------------------------------------------------------
-- Comentario  (NUEVA)
-- Estados:
--   visible       -> se muestra a todos.
--   oculto_auto   -> lo ocultó el algoritmo al llegar a 3 denuncias de
--                    usuarios distintos; queda en la cola del admin.
--   oculto_admin  -> un admin confirmó que infringe las reglas.
--   eliminado     -> lo borró su autor (borrado lógico: la API ya no lo
--                    devuelve, pero se conserva por si tenía denuncias
--                    pendientes y el autor intentó borrarlo para evadir
--                    la moderación).
-- total_denuncias cuenta solo denuncias NO resueltas.
-- No hay columna de edición: los comentarios no se pueden editar.
-- ---------------------------------------------------------------------
CREATE TABLE Comentario (
    id_comentario     INT AUTO_INCREMENT,
    id_reporte        INT            NOT NULL,
    id_usuario        INT            NOT NULL,
    contenido         VARCHAR(1000)  NOT NULL,
    anonimo           BOOLEAN        NOT NULL DEFAULT FALSE,
    estado            VARCHAR(20)    NOT NULL DEFAULT 'visible',
    total_denuncias   INT            NOT NULL DEFAULT 0,
    id_moderador      INT            NULL,
    fecha_moderacion  DATETIME       NULL,
    fecha_creacion    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_comentario           PRIMARY KEY (id_comentario),
    CONSTRAINT ck_comentario_estado    CHECK (estado IN ('visible', 'oculto_auto', 'oculto_admin', 'eliminado')),
    CONSTRAINT ck_comentario_denuncias CHECK (total_denuncias >= 0),
    CONSTRAINT fk_comentario_reporte   FOREIGN KEY (id_reporte)
        REFERENCES Reporte(id_reporte) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_comentario_usuario   FOREIGN KEY (id_usuario)
        REFERENCES Usuario(id_usuario) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_comentario_moderador FOREIGN KEY (id_moderador)
        REFERENCES Usuario(id_usuario) ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_comentario_reporte (id_reporte, estado, fecha_creacion),
    INDEX idx_comentario_usuario (id_usuario, fecha_creacion),
    INDEX idx_comentario_moderacion (estado, total_denuncias)
);

-- ---------------------------------------------------------------------
-- Denuncia_comentario  (NUEVA)
-- UNIQUE (id_comentario, id_usuario): un usuario solo puede denunciar un
-- comentario una vez, así nadie puede ocultar un comentario ajeno él solo
-- mandando 3 denuncias. El umbral exige 3 usuarios DISTINTOS.
-- resuelta: se marca TRUE cuando un admin revisa el caso (confirma u
-- restaura), para que las denuncias ya atendidas no vuelvan a contar.
-- ---------------------------------------------------------------------
CREATE TABLE Denuncia_comentario (
    id_denuncia     INT AUTO_INCREMENT,
    id_comentario   INT           NOT NULL,
    id_usuario      INT           NOT NULL,
    motivo          VARCHAR(30)   NOT NULL,
    detalle         VARCHAR(255)  NULL,
    resuelta        BOOLEAN       NOT NULL DEFAULT FALSE,
    fecha_denuncia  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_denuncia_comentario PRIMARY KEY (id_denuncia),
    CONSTRAINT uq_denuncia_usuario    UNIQUE (id_comentario, id_usuario),
    CONSTRAINT ck_denuncia_motivo     CHECK (motivo IN ('spam', 'acoso', 'lenguaje_ofensivo', 'informacion_personal', 'otro')),
    CONSTRAINT fk_denuncia_comentario FOREIGN KEY (id_comentario)
        REFERENCES Comentario(id_comentario) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_denuncia_usuario    FOREIGN KEY (id_usuario)
        REFERENCES Usuario(id_usuario) ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_denuncia_pendientes (resuelta, fecha_denuncia)
);

-- ---------------------------------------------------------------------
-- Notificacion
-- CAMBIOS:
--  - tipo: permite a la app mostrar íconos/acciones distintos sin tener que
--    interpretar el texto del mensaje.
--  - Índice para "mis notificaciones no leídas", la consulta más frecuente.
-- NOTA: si la notificación viene de un comentario anónimo, el mensaje NO
-- debe incluir el nombre del autor (lo controla la API).
-- ---------------------------------------------------------------------
CREATE TABLE Notificacion (
    id_notificacion  INT AUTO_INCREMENT,
    id_usuario       INT           NOT NULL,
    id_reporte       INT           NOT NULL,
    tipo             VARCHAR(30)   NOT NULL,
    mensaje          VARCHAR(255)  NOT NULL,
    leida            BOOLEAN       NOT NULL DEFAULT FALSE,
    fecha_creacion   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_notificacion         PRIMARY KEY (id_notificacion),
    CONSTRAINT ck_notificacion_tipo    CHECK (tipo IN ('reporte_validado', 'reporte_rechazado', 'nuevo_comentario', 'comentario_ocultado')),
    CONSTRAINT fk_notificacion_usuario FOREIGN KEY (id_usuario)
        REFERENCES Usuario(id_usuario) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_notificacion_reporte FOREIGN KEY (id_reporte)
        REFERENCES Reporte(id_reporte) ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_notificacion_usuario (id_usuario, leida, fecha_creacion)
);


-- =====================================================================
-- 5. DATOS INICIALES DE CATÁLOGOS
-- (El primer admin NO se crea aquí: su contraseña debe hashearse con
--  Argon2id, así que lo crea el script de seed de la API.)
-- =====================================================================
INSERT INTO Plataforma (nombre, es_otra) VALUES
    ('Mercado Libre', FALSE),
    ('Amazon México', FALSE),
    ('Facebook Marketplace', FALSE),
    ('Instagram', FALSE),
    ('TikTok Shop', FALSE),
    ('Shein', FALSE),
    ('Temu', FALSE),
    ('AliExpress', FALSE),
    ('Walmart', FALSE),
    ('Liverpool', FALSE),
    ('Coppel', FALSE),
    ('eBay', FALSE),
    ('WhatsApp', FALSE),
    ('Otra', TRUE);

INSERT INTO Categoria_fraude (nombre, descripcion) VALUES
    ('Producto no entregado', 'Se pagó el producto y nunca llegó.'),
    ('Producto falsificado', 'El producto recibido es una imitación.'),
    ('Producto distinto al anunciado', 'Lo recibido no coincide con la publicación.'),
    ('Vendedor falso o suplantación', 'El vendedor se hace pasar por una tienda o persona legítima.'),
    ('Sitio o enlace fraudulento', 'Página que imita a una tienda para robar datos o pagos.'),
    ('Cobro no autorizado', 'Cargos adicionales o no reconocidos después de la compra.'),
    ('Precio engañoso', 'Precio irreal usado como gancho para estafar.'),
    ('Otro', 'Fraude que no entra en las categorías anteriores.');


-- =====================================================================
-- 6. USUARIO DE BASE DE DATOS PARA LA API (MÍNIMO PRIVILEGIO)
-- La API NUNCA debe conectarse como root. Este usuario:
--  - No puede crear, alterar ni borrar tablas (sin DROP/ALTER/CREATE).
--  - No puede otorgar permisos (sin GRANT OPTION).
--  - En Bitacora_auditoria solo puede leer e insertar (append-only).
-- Ejecutar por separado, reemplazando la contraseña por una generada
-- (p. ej. `openssl rand -base64 32`) y el host por la subred donde vivirá
-- la API en su topología. NO subir la contraseña real a GitHub.
-- =====================================================================
-- CREATE USER 'clicksafe_api'@'10.0.20.%' IDENTIFIED BY 'REEMPLAZAR_POR_CONTRASEÑA_GENERADA';
--
-- GRANT SELECT, INSERT, UPDATE         ON clicksafe_db.Usuario             TO 'clicksafe_api'@'10.0.20.%';
-- GRANT SELECT, INSERT, UPDATE         ON clicksafe_db.Plataforma          TO 'clicksafe_api'@'10.0.20.%';
-- GRANT SELECT, INSERT, UPDATE         ON clicksafe_db.Categoria_fraude    TO 'clicksafe_api'@'10.0.20.%';
-- GRANT SELECT, INSERT, DELETE         ON clicksafe_db.Captcha_usado       TO 'clicksafe_api'@'10.0.20.%';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON clicksafe_db.Sesion              TO 'clicksafe_api'@'10.0.20.%';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON clicksafe_db.Token_verificacion  TO 'clicksafe_api'@'10.0.20.%';
-- GRANT SELECT, INSERT                 ON clicksafe_db.Bitacora_auditoria  TO 'clicksafe_api'@'10.0.20.%';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON clicksafe_db.Reporte             TO 'clicksafe_api'@'10.0.20.%';
-- GRANT SELECT, INSERT, DELETE         ON clicksafe_db.Evidencia           TO 'clicksafe_api'@'10.0.20.%';
-- GRANT SELECT, INSERT                 ON clicksafe_db.Revision_reporte    TO 'clicksafe_api'@'10.0.20.%';
-- GRANT SELECT, INSERT, DELETE         ON clicksafe_db.Like_reporte        TO 'clicksafe_api'@'10.0.20.%';
-- GRANT SELECT, INSERT, UPDATE         ON clicksafe_db.Comentario          TO 'clicksafe_api'@'10.0.20.%';
-- GRANT SELECT, INSERT, UPDATE         ON clicksafe_db.Denuncia_comentario TO 'clicksafe_api'@'10.0.20.%';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON clicksafe_db.Notificacion        TO 'clicksafe_api'@'10.0.20.%';
--
-- Nota: plataformas y categorías tienen INSERT/UPDATE porque el admin las
-- administra desde el panel, pero nunca DELETE: se desactivan con
-- activa = FALSE para no romper los reportes que ya las usan.
