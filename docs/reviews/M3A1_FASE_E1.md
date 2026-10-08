# M3A.1 — Fase E1: hardening y entregables

**Estado:** entregado para auditoría. Brief: `docs/briefs/M3A1_FASE_E.md` §E1
(aprobado en #21). **No se toca `apps/control`, la experiencia M2C.2 ni la
arquitectura de storage B1.** E2 no empieza hasta la auditoría de E1; E3 sigue
bloqueada por #15.

**Rama:** `fase/m3a1-e1` desde `main@78ad284`. Salida completa en
`M3A1_FASE_E1_SALIDA.txt`.

## Resultados (ejecución real, 2026-10-08)

Node 22.22.0 · pnpm 12.5.1 · PostgreSQL 16.15 en este entorno. Docker solo en
CI: acá no hay daemon.

| Gate | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | OK, **sin dependencias nuevas**: el OpenAPI no usa librería (ver spike) |
| `pnpm verify` | **666 passed + 1 skipped**. Lint: 0 errores y 12 warnings, los mismos que en `main` (la primera corrida dio 13 por un `console.log` del restore drill; se cambió por `process.stdout.write` y se re-contó: 12) |
| `pnpm build` | OK |
| PostgreSQL 16 | **232 passed + 6 skipped**. Nuevos: upload-limits 6, logs-sin-secretos 1, contract 8, restore-drill 1 |
| `bootstrap-smoke.sh` | 6 passed |
| media | 63 passed |
| mutaciones (226 reglas) | ver `_SALIDA.txt`. Las 11 nuevas `e1:` dan **11/11 atrapadas**. Una sobrevivió en la primera corrida y se cerró con un test (abajo) |
| compose-smoke (CI) | `/ready` en `ready` (database, storage y media `ok`), bootstrap y migraciones idempotentes, login inválido 401. Imágenes fijadas por digest |
| E2E M2C | Solo en CI: acá no hay Chrome con H.264 |

## Qué se entrega, punto por punto del brief

### 1. BL-10: límite por actor en el upload (§39)

- `apps/platform-api/src/upload-limiter.ts`: límite por **actor autenticado**, nunca solo por IP:
  - concurrencia (`UPLOAD_MAX_CONCURRENT_PER_ACTOR`, default 2);
  - tasa por ventana de 60 s (`UPLOAD_MAX_PER_MINUTE_PER_ACTOR`, default 30).
- Al superarlo responde 429 `RATE_LIMITED` con `Retry-After` y `details {reason, retryAfterSeconds}`.
- El cupo se pide después de auth, Idempotency-Key y `content-type`, y **antes de leer el cuerpo y de reservar la key**. Un 429 no deja temporal, ni Asset, ni key reservada, y la misma key sirve al reintentar.
- El cupo se devuelve en un `finally`, así que se libera también si el upload falla.
- No se usó `@fastify/rate-limit`: no hacía falta y evita la dependencia (GHSA-grpc-p53c-r64v no aplica).
- Memoria acotada: nunca descarta un actor con uploads en curso.
- **Límite conocido:** el contador es por proceso. Está documentado en `API.md`.
- Tests (`upload-limits.db.test.ts`):
  - N+1 uploads por HTTP real con el cuerpo a medio escribir: 429 sin temporal, sin Asset y sin key, y otro actor no se ve afectado;
  - la ventana con reloj falso;
  - un fallo libera el cupo;
  - 400/415/401 no consumen cupo;
  - evicción;
  - variables de entorno.

### 2. BL-11: OpenAPI (§47). Resultado del spike

No se adoptó `zod-to-openapi`. Su línea 7.x para Zod 3 no tiene soporte activo y sería una dependencia nueva bajo la política de supply chain. Tampoco se escribió el JSON a mano. En su lugar:

- `apps/platform-api/src/openapi.ts`:
  - conversor Zod → JSON Schema, hecho en el repo, para el subconjunto que usa la API; ante una construcción desconocida **falla**, no degrada;
  - tabla `ROUTES` con roles, CSRF, Idempotency-Key, multipart y códigos de error. Los roles salen de **las mismas constantes** que los handlers pasan a `requireActor`.
- Los schemas publicados son **los mismos objetos Zod** que validan entradas y respuestas. Por eso el pedido del brief de que cada schema Zod valide el JSON se cumple por construcción.
- Cobertura:
  - multipart (`surfaceType` + `file`, `type` + `file`);
  - contrato `Error` en cada código;
  - headers `Idempotency-Key` y `X-CSRF-Token`;
  - cookie de sesión como `securityScheme`.
- `docs/platform/openapi.json` se regenera con `pnpm docs:contract`.
- CI exige diff vacío de dos maneras: un paso en `verify-build` (`git diff --exit-code`) y el test `contract.db.test.ts`.
- Ese test prueba además, contra la app real:
  - tabla = rutas registradas por Fastify, sin faltantes ni sobrantes;
  - matriz rol × ruta: FORBIDDEN exactamente para los roles no declarados (22 rutas × 4 roles = 88 combinaciones);
  - 401 sin actor;
  - Idempotency-Key exigida solo donde se declara;
  - CSRF declarado = mutación con sesión;
  - todos los `$ref` resuelven.

### 3. §35: compose reproducible

- `docker compose up` levanta postgres + platform-api. Las dos imágenes van **fijadas por digest**, resuelto en CI: [run 37839307934](https://github.com/fermalenoski86/dev/actions/runs/37839307934).
- Job nuevo `compose-smoke` (`scripts/ci/compose-smoke.sh`):
  - `.env` descartable con contraseñas aleatorias;
  - bootstrap con psql dos veces;
  - `pnpm db:migrate` dos veces, la segunda con `[]`;
  - `/ready` en `ok`;
  - login inválido 401;
  - si una imagen no está fijada por digest, el job falla.
- CLI nuevo `pnpm db:migrate`: migra como `trust_owner`. Antes no había forma operativa de migrar fuera de los tests.
- **MinIO: hallazgo.** La primera corrida falló con `pull access denied for minio/minio`. El sondeo real en CI confirma:
  - `minio/minio` y `quay.io/minio/minio` ya no se pueden bajar sin login;
  - SeaweedFS, RustFS y Garage sí.
- MinIO quedó detrás del perfil `s3`, sin cambiar la arquitectura de storage. El reemplazo para dev/CI es la **decisión de producto #22**, con opciones y recomendación.
- Mientras siga abierta, el contrato S3 (`s3.contract.test.ts`) **sigue sin ejecutarse nunca**. Lo digo explícitamente: el punto 3 está cumplido para postgres + platform-api y pendiente para S3.

### 4. §33: `docs/ops/BACKUPS.md`

- PostgreSQL: backup diario, PITR, retención y RPO/RTO. Las cifras van marcadas *(propuesta)* para que Fer las confirme.
- Object storage: versioning, Object Lock y lifecycle.
- Blobs aprobados no borrables desde la aplicación: hoy ya lo garantizan el código y los tests. No hay operación de borrado de blobs finales, no hay rutas `DELETE`, y los triggers `IMMUTABLE_ROW` lo aseguran en la base.
- Todo como requisitos e interfaces, sin proveedor.
- **Restore probado:** `restore-drill.db.test.ts` corre en cada PR (job `postgres`) los mismos comandos del documento:
  1. `pg_dump -Fc`;
  2. `pg_restore --exit-on-error --single-transaction` en una base nueva;
  3. verifica las mismas filas en cada una de las 18 tablas, `verifyChain` idéntico, `migrateUp = []`, que `trust_app` lea, y que UPDATE sobre audit y DELETE sobre `stored_objects` sigan fallando.
- Salida real: `dump 80070 bytes en 114 ms · restore en 136 ms · 18 tablas · 3 audit events · verifyChain ok`. Es una base chica: prueba el procedimiento, no el RTO de producción (eso es BL-24).

### 5. §34: logs sin secretos

`logs-sin-secretos.db.test.ts` usa el logger de producción (JSON con redacción) en nivel **debug**, con sesiones y CSRF reales. Recorre login, upload, submit, evidencia, approve y logout. También manda una password incorrecta, una cookie falsa y un CSRF falso.

Verifica:

- que no aparezcan passwords, tokens, CSRF, valores falsos ni la Idempotency-Key, ni literales ni URL-encoded;
- que cada línea sea JSON válido;
- que haya eventos de cada etapa.

Nota honesta: el serializer de request de Fastify no vuelca headers, así que la redacción es una segunda barrera. La mutación `e1: login loguea el cuerpo` prueba que el test atrapa una fuga real.

### 6. §47: `docs/platform/DELIVERY.md`

Generado, no escrito a mano.

- La **route list sale del registro de Fastify**: `pnpm docs:contract` arma la app real y escucha `onRoute`. Si hay una ruta registrada sin documentar, o documentada y no registrada, la generación falla.
- Incluye migraciones (del `MIGRATIONS` que corre el migrator), los 58 archivos de test con su suite, las variables de `.env.example` y enlaces al ERD, OpenAPI, API y BACKUPS.
- Mismo check de CI que el OpenAPI.

## Mutaciones nuevas (11 `e1:`)

| Regla | Qué rompe |
|---|---|
| e1: cupo de upload nunca devuelto | el cupo queda tomado para siempre |
| e1: límite de upload ignorado | deja pasar uploads por encima del límite |
| e1: 429 sin Retry-After | el 429 sale sin `Retry-After` |
| e1: ventana de tasa nunca se reinicia | la ventana de tasa no se renueva |
| e1: release doble descuenta dos veces | un `release` repetido descuenta dos veces |
| e1: descarta actores con uploads en curso | la evicción saca a un actor con uploads activos (**sobrevivió en la primera corrida**: se agregó el caso "el más viejo en curso, el nuevo inactivo" y ahora se atrapa) |
| e1: tabla OpenAPI con un rol de más | la tabla declara un rol que el handler no acepta |
| e1: Idempotency-Key no declarada | la tabla omite una Idempotency-Key que el handler exige |
| e1: conversor pierde strict | el conversor pierde `strict` |
| e1: ruta registrada sin documentar | hay una ruta registrada que la tabla no tiene |
| e1: login loguea el cuerpo | el login vuelca el cuerpo, con la password, al log |

## No hecho a propósito

- **S3 en compose y el contrato S3:** dependen de #22. No elegí reemplazo por mi cuenta.
- **Store compartido para el límite de uploads:** con más de una instancia cada una cuenta por separado. Está documentado. Hoy el despliegue es de una instancia.
- **Ensayo de restore sobre un backup real:** es BL-24 (backlog). El de E1 prueba el procedimiento, no el tamaño.
- **El contenedor de platform-api instala ffmpeg con `apt-get` en cada arranque:** las imágenes base están fijadas, pero los paquetes de apt no. Va como propuesta 1.

## Propuestas de mejora (≤ 3)

1. **Imagen de platform-api construida y fijada (Dockerfile multi-stage).**
   - *Problema:* hoy el compose arranca `node:22-bookworm` y en cada start corre `apt-get install ffmpeg` y `pnpm install`. Las versiones de apt no están fijadas y el arranque tarda unos 20 s más (visto en compose-smoke).
   - *Beneficio:* arranque reproducible y una versión exacta de ffmpeg/ffprobe, que es la autoridad de validación de medios (§24).
   - *Prioridad:* media. *Esfuerzo:* ~0,5 día. *Dependencias:* ninguna.
   - *Criterio de éxito:* compose-smoke usa la imagen construida, `ffprobe -version` coincide con la fijada y el `/ready` sale en menos de 10 s.
   - *Fuentes:* Docker, "Multi-stage builds" (https://docs.docker.com/build/building/multi-stage/), y Debian snapshot para fijar paquetes (https://snapshot.debian.org/).
2. **Reconciliación base ↔ bucket (`pnpm ops:verify-blobs`).**
   - *Problema:* después de un restore, nada verifica que cada `stored_objects.storage_key` exista en el bucket con su SHA-256.
   - *Beneficio:* cierra el último paso manual de BACKUPS.md §4 y detecta corrupción silenciosa.
   - *Prioridad:* media. *Esfuerzo:* ~0,5 día. *Dependencias:* #22 para probarlo también contra S3.
   - *Criterio de éxito:* test con un blob faltante y otro con hash alterado: el comando sale distinto de 0 y nombra los dos.
3. **Sondeo de imágenes semanal (cron de CI).**
   - *Problema:* MinIO desapareció del registry y lo descubrimos recién al correr el smoke.
   - *Beneficio:* aviso temprano si una imagen fijada deja de poder bajarse.
   - *Prioridad:* baja. *Esfuerzo:* ~1 h. *Dependencias:* ninguna.
   - *Criterio de éxito:* un workflow programado corre `docker pull` de cada digest del compose y abre un issue si alguno falla.

### Evaluación de las ideas de ChatGPT (HANDOFF, mejora continua)

1. **Diagnóstico operativo (real o simulado, y qué acción tomar):** de acuerdo. E1 deja la base del lado de la plataforma: `/ready` con checks por componente y logs JSON con eventos. Para TRUST lo valioso es el lado del show (pantallas, luces y reloj), que vive en `apps/control`, congelado. Propongo que vaya al roadmap después de #15, con la regla de que todo indicador diga si es medido o simulado.
2. **Ensayo de escenas antes de publicar:** de acuerdo en parte. La validación de medios y el preflight server-side ya existen (B3 y C3). Lo que falta es la previsualización y la sincronía según hardware real, y eso necesita la información de hardware que hoy no tenemos. Queda para Fer.
3. **Recuperación segura y rollback:** ya está cubierto en buena parte. Las versiones son inmutables, con hash, y la última aprobada queda aparte del draft (D1). E1 suma el restore probado. "Rollback a la versión aprobada anterior" sería una operación nueva de producto, así que va como decisión de Fer y no como mejora técnica.

## Investigación aplicada (fuentes consultadas en E1)

- OWASP API Security Top 10 2023, API4 "Unrestricted Resource Consumption" (https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/): límites por cliente autenticado, concurrencia y 429. Aplicado en BL-10.
- RFC 9110 §10.2.3 `Retry-After` (https://www.rfc-editor.org/rfc/rfc9110#section-10.2.3): segundos enteros. Aplicado.
- PostgreSQL 16, cap. 26 "Backup and Restore" (https://www.postgresql.org/docs/16/backup.html): `pg_dump -Fc`, `pg_restore` y probar los restores. Aplicado en el drill.
- Retiro de las imágenes de MinIO: fuentes secundarias en #22. **Verificado empíricamente** con el sondeo de CI; las fechas exactas de las fuentes no las verifiqué.
