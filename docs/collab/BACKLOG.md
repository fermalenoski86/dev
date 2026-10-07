# BACKLOG de mejoras — debate Claude ↔ ChatGPT

Cada ítem: problema → beneficio → prioridad/esfuerzo → dependencias → criterio
verificable → **estado del debate**. Nada se implementa sin acuerdo registrado
acá, y la fase activa siempre va primero. Lo que cambia producto o depende de
hardware que todavía no existe queda para Fer (`decisión-producto`).

Estados: `propuesta` · `aceptada` (backlog, falta turno) · `en PR #n` ·
`verificada` · `descartada (motivo)` · `Fer decide`.

---

## BL-01 · Runner de mutaciones acotado y con diagnóstico — *ChatGPT, 2026-10-07*
**Estado: aceptada con ajustes (Claude, 2026-10-07).** Se implementa en un PR
propio **después de mergear el PR #2** (toca el mismo archivo).

Ajustes de Claude:
1. `subprocess.Popen(..., start_new_session=True)` y, al vencer el timeout,
   `os.killpg(pgid, SIGKILL)`: mata vitest **y sus workers**, no solo el shell.
   Esa es la limitación que señaló ChatGPT y la que hay que probar.
2. Sin `| grep`: el runner lee toda la salida y busca la línea `Tests` en
   Python. Si no la encuentra, guarda las **últimas 40 líneas** en
   `.mutation-diagnostics/<regla>.log` (ignorado por git). Así un EUSAGE
   aparece con su texto, no como SIN SALIDA.
3. Nuevo estado `TIMEOUT` (tumba el gate igual que SIN SALIDA).
   `MUTATION_TIMEOUT_S` por regla: default 300 s; media 600 s.
4. Pruebas: un `MUTATION_TEST_CMD` que lanza `sleep 600` y un nieto
   (`sh -c 'sleep 600 & sleep 600'`) → TIMEOUT dentro del presupuesto, exit 1,
   ningún pid vivo, sin diff y con el journal vacío. Y 109/109 siguen atrapadas.

## BL-02 · CI de GitHub como evidencia independiente — *Claude, 2026-10-07*
**Estado: en PR #2** (es lo que destraba la verificación independiente de PostgreSQL).
- Problema: el entorno del auditor no puede crear el usuario `postgres` ni
  cambiar de UID, y las salidas de Claude no cuentan como verificación
  independiente (con razón). Hoy cada gate depende de que *alguno* de los dos
  agentes tenga el entorno justo.
- Propuesta: `.github/workflows/gates.yml` corre los gates de AGENTS.md
  (verify+build, PostgreSQL 16 + bootstrap, media real, E2E M2C, mutaciones) en
  un runner limpio de GitHub, gratis en repos públicos. `pg-up.sh` ahora
  arranca PostgreSQL **sin root** (como hace el runner), y así también en
  Codex si corre como usuario normal.
- Criterio: los 5 jobs en verde sobre el HEAD del PR, links a la corrida en el
  reporte. El auditor puede citar la corrida como evidencia de un tercero.
- Límite: CI es un tercer entorno, no reemplaza la revisión de código ni la
  ejecución propia del auditor cuando la pueda hacer.

## BL-03 · Rechazos que le dicen a la agencia cómo arreglar el archivo — *Claude*
**Estado: propuesta.** Encaja en **B3/B4** (contratos + API), sin cambio de producto.
- Problema: hoy un rechazo dice `ASSET_BAD_FPS {accepted:[25/1,30/1], actual:30000/1001}`.
  Correcto, pero la agencia igual tiene que adivinar cómo exportar. Cada ida y
  vuelta con la agencia demora el takeover.
- Propuesta: `remediation` en cada `AssetRejection`, generado desde la **misma
  autoridad** (`deriveSurfaceFormats(EL_TRUST)` + política): texto corto y el
  comando de transcodificación exacto (`ffmpeg -i in.mov -vf scale=1920:412,fps=30 -c:v libx264 -pix_fmt yuv420p …`).
  No se ejecuta nada del lado del servidor: es texto para el cliente.
- Criterio: los 12 códigos tienen remediación; un test aplica el comando sugerido
  a cada fixture rechazable (resolución, fps, codec, contenedor) y el resultado
  **pasa** `checkMedia`. Si la autoridad cambia, cambia la sugerencia (test de autoridad).
- Esfuerzo: ~1 día. Valor comercial directo (onboarding de agencias).

## BL-04 · Kit de especificación por superficie generado por la autoridad — *Claude*
**Estado: propuesta.** Después de B4 (o Fase E). Sin hardware.
- Problema: la ficha técnica que recibe una agencia es un PDF hecho a mano.
  Si cambia el modelo del edificio, la ficha queda vieja.
- Propuesta: `pnpm spec-kit` genera, desde `EL_TRUST`, una plantilla PNG por
  superficie (resolución exacta, zonas seguras, posición de cada pantalla en la
  fachada), un MP4 de prueba válido por superficie y un `SPEC.md` con fps,
  codec y duración. Es la contracara de BL-03: lo que se pide = lo que se valida.
- Criterio: cada MP4 de prueba del kit pasa `checkMedia`. Cambiar la resolución
  en el modelo cambia el kit (test).

## BL-05 · Política de pixel format (pregunta yuv420p) — *abierta desde B2*
**Estado: Fer decide.** Necesita la ficha del procesador/controladora LED real.
Mientras tanto, propuesta mínima sin cambiar la política: B3 guarda
`pixelFormat` y `profile` (ya se extraen) para poder aplicar la regla después
sin volver a inspeccionar.

---

## Evaluación de las ideas de Fer (2026-10-07) — Claude

**F1 · Diagnóstico operativo (qué anda, qué está degradado, qué hacer; medido vs simulado).**
Útil y con base existente: CONTROL ya separa `logicalState` / `deviceHealth` /
`provenance` (ADR-020/027) y DEMO CHECK corre pruebas reales del navegador. Lo
que **falta** es la columna "acción del operador": para cada estado degradado,
qué hacer en concreto (ej. "pantalla Corrientes STALE hace 40 s → verificar
enlace del procesador; el show sigue en las demás"). Propuesta: catálogo
`OperatorAction` por código de alarma/estado, testeado contra la tabla de
estados, en **Fase E (hardening)**. Hoy todo está simulado: el diagnóstico tiene
que decir *SIMULADO* en grande, nunca "OK". **Aceptada para Fase E.**

**F2 · Ensayo de escenas antes de publicar.**
Ya existe la mitad: preflight del ShowPackage, PREVIS (digital twin), WARM UP
MEDIA y, desde B2, validación real de medios. Falta "sincronía según el
hardware real", y eso **no se puede medir sin hardware**: los offsets de
pantallas/luces/reloj dependen del procesador LED y del controlador DMX que
todavía no existen (README de hardware). Propuesta ahora: un **reporte de
ensayo** que junte preflight + validación de cada asset + presupuesto de
sincronía *declarado* (con el supuesto explícito) y que el aprobador vea antes
de aprobar (encaja en **Fase C**, aprobación four-eyes). La medición real de
sincronía → **Fer decide** cuando haya hardware (ver BL-06).

**F3 · Recuperación segura y trazable (versiones, rollback, registro).**
La base ya está: ShowVersion inmutable y sellada (hash JCS + manifest
congelado), audit encadenado por hash, StoredObject content-addressed. Un
rollback es "volver a desplegar una versión aprobada anterior", no deshacer
nada. Lo que falta: (a) la operación `redeploy(versionId)` con audit y
four-eyes; (b) "último estado bueno conocido" en EDGE para cuando se cae la
conexión. (a) va con **Fase C/D**; (b) es EDGE, fuera de M3A.1 → **Fer decide**
el milestone. **Aceptada (a); (b) a decisión.**

## BL-06 · Medición de sincronía pantallas/luces/reloj — *Claude*
**Estado: Fer decide** (depende de hardware).
Cuando exista el procesador LED: un arnés de medición (cámara a 240 fps
apuntada a la fachada + patrón de flashes codificados en tiempo) que mida el
offset real entre superficies. Sin eso, cualquier "sincronizado" es una
promesa. Requiere acceso al edificio.

## BL-07 · Reporte de Assets no terminales vencidos — *Claude, B3*
**Estado: aceptada con ajuste (ChatGPT, auditoría B3 #1).** Primera etapa:
**solo reporte operativo**. Un fallo de infraestructura no se convierte en
REJECTED de contenido; un código contractual nuevo requiere debate y decisión
registrada. Criterio: un Asset VALIDATING/UPLOADING con `updated_at` > TTL
aparece en el reporte; uno reciente no.

## BL-08 · Reporte de blobs huérfanos — *Claude, B3*
**Estado: aceptada (ChatGPT, auditoría B3 #1).** Report-only, con período de
gracia y **cero borrados automáticos**. Criterio: con el huérfano real de §33 y
un blob con StoredObject, solo el primero aparece.

## BL-09 · E2E M2C reproducible fuera de GitHub — *Claude, B3*
**Estado: aceptada para después de cerrar B3 (ChatGPT).** Fijar versión/digest
del navegador o contenedor y demostrar 14/14 en un entorno limpio. No dispensa
el gate E2E actual.
