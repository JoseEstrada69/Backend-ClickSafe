# CLAUDE.md — Backend de ClickSafe

> Este archivo es tu contexto permanente para este repositorio, pero **solo
> cubre cómo trabajar conmigo** (idioma, nivel de explicación, git, qué
> nunca hacer). Toda la documentación del proyecto en sí — reglas de
> negocio, stack, estructura, arquitectura de seguridad, endpoints — vive
> en [MANUAL.md](MANUAL.md). Léelo antes de tocar cualquier regla de
> negocio o decisión técnica. Si algo aquí contradice lo que "normalmente"
> harías, **gana este archivo**. Si algo no está cubierto o es ambiguo,
> **pregunta antes de inventar**.

El proyecto ya se presentó al socio formador y pasó por su ronda de
pruebas de penetración (ver `demo-vulnerable` si existe como rama local,
nunca mezclada a `main`). Las fases 0-7 de `MANUAL.md` sección 9 están
completas: lo que queda es mantenimiento, correcciones puntuales y pulido
final, no nuevas fases grandes.

---

## 0. Cómo debes trabajar conmigo

- **Idioma:** respóndeme siempre en español. El código (nombres de
  variables, clases, funciones) va en inglés, **excepto** los nombres de
  tablas y columnas de la base de datos, que ya existen en español y NO se
  renombran.
- **Explica lo que haces.** Soy estudiante y este proyecto es para la
  materia *Integración de seguridad informática en redes y sistemas de
  software* (Tec de Monterrey). Al terminar cada cambio no trivial
  explícame en detalle:
  1. qué hiciste y por qué,
  2. cómo funciona,
  3. si es un control de seguridad: **qué ataque concreto previene** y
     cómo sería ese ataque si no existiera el control.
- **Trabaja de forma incremental.** Para cualquier cambio que no sea
  trivial: corre lint + tests + build, resume lo hecho y espera mi
  confirmación antes de seguir con lo siguiente. (El framework de "fases"
  por el que se organizó el desarrollo original ya no aplica — ver
  `MANUAL.md` sección 9 — pero la misma disciplina de ir por pasos sigue.)
- **Nunca** desactives una validación, un guard o una regla de seguridad
  para "hacer que algo funcione" en el proyecto real (`main` y sus ramas de
  feature/fix). Si algo choca con una regla de este archivo o de
  `MANUAL.md`, detente y pregúntame. (Esto no aplica a ramas de demo de
  seguridad creadas a propósito y explícitamente pedidas, como
  `demo-vulnerable`, que por definición existen para violar estas reglas
  de forma controlada y nunca se mezclan a `main`.)
- **Nunca** escribas secretos reales en el código ni en archivos versionados.
- Si necesitas instalar un paquete, dime cuál, para qué, y verifica que
  esté mantenido (última publicación reciente, sin vulnerabilidades en
  `npm audit`). Prefiere pocas dependencias.
- Mi sistema operativo es **Windows**. Los comandos que me pidas correr
  deben funcionar en PowerShell. Los scripts del proyecto deben ser
  scripts de npm (multiplataforma), no scripts de bash.

---

## 10. Git

- `main` siempre debe compilar y funcionar. **Nunca** commitear directo a `main`.
- Una rama por cambio: `feat/...`, `fix/...`, `docs/...`. Se integra a
  `main` con un Pull Request.
- Commits pequeños con Conventional Commits en español:
  `feat(auth): rotación de refresh tokens con detección de reuso`.
- Antes de cada commit, revisa `git diff --staged` en busca de secretos o
  archivos `.env`. Si detectas un secreto commiteado, avísame de inmediato
  (hay que rotarlo; borrarlo del historial no basta).
- No hagas `push --force` a `main`.

---

## 11. Cosas que NUNCA debes hacer (en el proyecto real)

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
- Marcar como pública una ruta que no corresponda, según el contrato de
  `MANUAL.md` sección 7.
- Desactivar ESLint, `strict` de TypeScript o tests para que algo pase.

(Todo lo anterior es exactamente lo que una rama de demo de seguridad como
`demo-vulnerable` existe para violar a propósito, documentado y aislado de
`main` — ver la nota al inicio de este archivo.)
