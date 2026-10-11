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
**Estado: en PR de B4** (`packages/platform-media/src/remediation.ts`; receta aplicada con ffmpeg real a 10 rechazos → todos pasan `checkMedia`). Antes: propuesta. Encaja en **B3/B4** (contratos + API), sin cambio de producto.
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
el milestone. **Aceptada (a); (b) a decisión.** Tras cerrar BL-08, el siguiente paso acordado es un brief documental separado para (a), con semántica de autorización, four-eyes, auditoría y pruebas; no se implementa hasta que Claude y ChatGPT acuerden ese brief. **Brief en PR #50; Fer decidió Q0 = A (puntero administrativo, sin Deploy) y Q2 = A2.2 (nunca automática, siempre dos personas) en #52 → ADR-064. Brief aprobado en #50 (`main@0742479`); implementación en `fase/f3a` (migración 0004), en auditoría.**

## BL-06 · Medición de sincronía pantallas/luces/reloj — *Claude*
**Estado: Fer decide** (depende de hardware).
Cuando exista el procesador LED: un arnés de medición (cámara a 240 fps
apuntada a la fachada + patrón de flashes codificados en tiempo) que mida el
offset real entre superficies. Sin eso, cualquier "sincronizado" es una
promesa. Requiere acceso al edificio.

## BL-07 · Reporte de Assets no terminales vencidos — *Claude, B3*
**Estado: verificada y mergeada en PR #45 (`main@e19ac239`, ChatGPT 2026-10-11).** Aceptada con ajuste (ChatGPT, auditoría B3 #1). [Auditoría aprobada](https://github.com/fermalenoski86/dev/pull/45#issuecomment-6106041561); CI exacta 38111886913: 7/7 jobs al primer intento, 289/289 mutaciones y M2C 14/14. Primera etapa:
**solo reporte operativo**. Un fallo de infraestructura no se convierte en
REJECTED de contenido; un código contractual nuevo requiere debate y decisión
registrada. Criterio: un Asset VALIDATING/UPLOADING con `updated_at` > TTL
aparece en el reporte; uno reciente no.

## BL-08 · Reporte de blobs huérfanos — *Claude, B3*
**Estado: verificada y mergeada en PR #48 (`main@5f06effa`, ChatGPT 2026-10-11).** Aceptada (ChatGPT, auditoría B3 #1). [Auditoría aprobada](https://github.com/fermalenoski86/dev/pull/48#issuecomment-6106938699); CI exacta 38117608607: 7/7 jobs al primer intento, 298/298 mutaciones, M2C 14/14 y contrato S3 16/16. Report-only, con período de
gracia y **cero borrados automáticos**. Criterio: con el huérfano real de §33 y
un blob con StoredObject, solo el primero aparece.

## BL-09 · E2E M2C reproducible fuera de GitHub — *Claude, B3*
**Estado: aceptada con ajuste de observabilidad (Claude ↔ ChatGPT, 2026-10-09).**
Antes de fijar navegador o cambiar el gate, un PR pequeño y separado debe:
- registrar SHA, versión exacta de Chrome, ImageOS/ImageVersion y
  `canPlayType('video/mp4; codecs="avc1.42E01E"')`;
- ante `failure()`, publicar `test-results/` con trace, screenshot y logs
  disponibles; la configuración ya usa `trace: retain-on-failure`, no
  duplicarla por CLI salvo evidencia de que el comando actual la ignora;
- mantener intactos asserts, timeouts, umbrales, `retries: 0` y
  `apps/control`; el job original debe continuar en rojo ante la falla.

Criterio: una falla controlada produce un artefacto recuperable con SHA y
versiones, mientras el job conserva estado failure; una corrida normal mantiene
M2C 14/14. Reunir 3–4 fallos reales antes de decidir si fijar Chrome. No dispensa
el gate actual ni autoriza modificar la parte congelada. Prioridad P2,
esfuerzo <0,5 día; implementar en PR propio después de E1 sin mezclar con D3.
Fuente primaria (consulta 2026-10-09 UTC):
https://playwright.dev/docs/trace-viewer. Límite: la traza ayuda a diagnosticar,
pero no demuestra por sí sola una causa de rendimiento o codecs.

## BL-10 · Límite de tasa y de consumo por actor en el upload — *Claude, B4*
**Estado: aceptada con ajuste para Fase C (ChatGPT, aprobación de B4,
2026-10-07).** Ajustes del auditor:
- Límite **por actor autenticado** (no solo por IP), y además de requests por
  minuto, **uploads/inspecciones concurrentes** por actor (OWASP API4:2023).
- Si se usa `@fastify/rate-limit`: `keyGenerator` por actor, `Retry-After`,
  store compartido si hay más de una instancia; **versión fijada y corregida**
  respecto del bypass por rotación IPv6 (GHSA-grpc-p53c-r64v). Nunca solo IP.
- Criterio: N+1 uploads simultáneos del mismo actor → 429 con `Retry-After`,
  sin temporal, sin Asset y sin Idempotency-Key reservada.
- Fuentes (consultadas por el auditor 2026-10-07): OWASP API4:2023
  https://api-security.owasp.org/editions/2023/en/0xa4-unrestricted-resource-consumption/ ·
  https://github.com/fastify/fastify-rate-limit ·
  https://github.com/fastify/fastify-rate-limit/security/advisories/GHSA-grpc-p53c-r64v
- Evaluación de Claude: de acuerdo. El límite de **login** de C1 ya agrupa IPv6
  por /64 por la misma razón. El de uploads necesita el actor real (C1), así
  que va después de C1.

## BL-11 · OpenAPI generado desde los schemas Zod — *Claude, B4*
**Estado: aceptada con ajuste para Fase C/E (ChatGPT, 2026-10-07).** Ajustes:
- `zod-to-openapi` para Zod 3 es la línea **7.3.4, sin soporte activo**
  (doc oficial: https://github.com/asteasolutions/zod-to-openapi). Antes de
  adoptarla: spike corto, versión fijada, generación determinista y un CI que
  regenere y exija diff vacío.
- Si no cubre multipart, el contrato de error y los headers sin extensiones
  manuales frágiles, se mantiene el contrato equivalente actual
  (`docs/platform/API.md` + schemas) y se reevalúa.
- Evaluación de Claude: de acuerdo. Alternativa a evaluar en el spike: escribir
  el `openapi.json` a mano y testear que cada schema Zod lo valide (sin
  dependencia nueva).


## BL-23 · Matriz de aceptación ejecutable — seguimiento E2, 2026-10-09
**Estado: verificada y mergeada en PR #29 (`main@0234055a572107ca3623363bcb8e45d7dfe6326c`, ChatGPT 2026-10-09).**
Acuerdo de Claude: https://github.com/fermalenoski86/dev/pull/20#issuecomment-6063828202.
Auditoría inicial: https://github.com/fermalenoski86/dev/pull/29#issuecomment-6078625925. Aprobación: https://github.com/fermalenoski86/dev/pull/29#issuecomment-6080498773.
- Problema: matriz manual sin vínculo comprobado con tests/CI; puede conservar cobertura obsoleta.
- Beneficio: trazabilidad verificable de los 19 puntos de §48, con pendientes explícitos.
- Implementada por Claude y revalidada por ChatGPT: 12 tests etiquetados, 19 puntos, estados explícitos y resultado JSON real de Vitest.
- Acuerdo vigente: generación desde tags de tests y validación de estados cubierto/pendiente/no aplicable; no convertir pendientes en verde. No alterar M2C congelado.
- Verificación: negativo real sin `[§48.17]` falló y se recuperó; 9/9 tests del validador; 3/3 mutaciones nuevas atrapadas; CI 37915601096 completa, 247/247 mutaciones y M2C 14/14.
- Fuente primaria consultada 2026-10-09: https://v2.vitest.dev/guide/reporters#json-reporter. Vitest 2 puede emitir nombre completo y estado en JSON. Aplicación propuesta: relacionar resultados con tags; límite: no demuestra suficiencia de asserts ni reemplaza gates de navegador. Es seguimiento del acuerdo existente, no una mejora nueva ni verificada.

## BL-27 · Alta de usuarios por API solo ADMIN — debate E2, 2026-10-09
**Estado: Fer decide; no encargada ni implementada.**
- Claude propone API ADMIN para evitar sembrar usuarios de tests y facilitar una futura UI de administración; estima ~1 día. Fuente interna: reporte E2 del PR #29.
- ChatGPT: difiere. La preparación de usuarios de tests no justifica por sí sola ampliar la API; E3 autorizada en #31 cubre login/campañas/aprobación, no alta administrativa.
- Beneficio potencial: operación del alta sin CLI. Prioridad posterior a E3; depende de necesidad de producto confirmada por Fer.
- Si se autoriza: criterio mínimo de acceso ADMIN, rechazo de otros roles y auditoría sin secretos. Alcance detallado en brief propio antes de implementar.

## BL-28 · Accesibilidad operativa de E3 — *Claude, ajustada por ChatGPT*
**Estado: aceptada e incorporada al brief E3 aprobado; implementación pendiente en E3b/E3c.**
Debate inicial: https://github.com/fermalenoski86/dev/pull/32#issuecomment-6084515242. Aprobación del brief corregido: https://github.com/fermalenoski86/dev/pull/32#issuecomment-6088307539.
- Problema: la UI nueva puede ser operable visualmente y aun fallar con teclado,
  foco, nombres accesibles o anuncio de errores.
- Acuerdo propuesto: axe en login, campañas y revisión, más recorridos Playwright
  de teclado, foco visible, nombres accesibles y errores anunciados. No afirmar
  conformidad WCAG completa solo por un escaneo automático.
- Prioridad/esfuerzo: P1, ~0,5 día, dentro de E3.
- Criterio medible: cero violaciones axe en las vistas acordadas y el flujo
  principal se completa solo con teclado; los checks no relajan §41 ni M2C.
- Fuente primaria consultada 2026-10-09:
  https://playwright.dev/docs/accessibility-testing. Playwright documenta que
  axe mezcla reglas ligadas a WCAG y best practices; límite: automatización no
  sustituye evaluación manual completa.

## BL-29 · Manifest y retención de evidencia E3 — *ChatGPT*
**Estado: aceptada e incorporada al brief E3 aprobado; implementación pendiente en E3c.**
Debate inicial: https://github.com/fermalenoski86/dev/pull/32#issuecomment-6084515242. Aprobación del brief corregido: https://github.com/fermalenoski86/dev/pull/32#issuecomment-6088307539.
- Problema: un enlace a un run no identifica por sí solo qué commit, navegador,
  roles, campaña, versión y hash produjeron cada screenshot/video; los artifacts
  se eliminan según la retención configurada.
- Beneficio: evidencia técnica y comercial auditable sin versionar binarios.
- Prioridad/esfuerzo: P2, <0,5 día, dentro de E3c.
- Criterio medible: artifact con manifest JSON validado por CI que incluya SHA,
  navegador, roles, campaignId, versionId/hash, specs y resultado, y
  `retention-days` explícito.
- Fuente primaria consultada 2026-10-09:
  https://docs.github.com/en/actions/tutorials/store-and-share-data#configuring-a-custom-artifact-retention-period.
  Límite: el manifest mejora trazabilidad, pero no prueba por sí solo la
  corrección visual ni sustituye el E2E.

## BL-30 · Validar la URL pública de la API al construir E3 — *Claude, ajustada por ChatGPT*
**Estado: aceptada con ajuste para E3c; no implementada.**
Debate y aprobación de E3a: https://github.com/fermalenoski86/dev/pull/34#issuecomment-6089938993.
- Problema: `platform-web` hoy puede compilar sin `NEXT_PUBLIC_TRUST_API_URL`
  y recién informa la mala configuración en runtime.
- Beneficio: fail-fast del despliegue y garantía de que el bundle de producción
  apunta a una API HTTPS explícita.
- Ajuste del auditor: el job `e2e-platform` construye con una URL HTTPS de
  test y debe tener negativos verificables para variable ausente y para
  `http:`. Documentar que el bundle queda ligado a ese entorno; el gate
  general debe declarar su URL de prueba y no ocultar la dependencia.
- Prioridad/esfuerzo: P2, ~1 h, dentro de E3c.
- Criterio: el build de producción sin variable o con `http:` falla con un
  mensaje claro; con una URL HTTPS válida compila y el E2E multihost usa
  exactamente ese origen.
- Fuente primaria consultada 2026-10-09:
  https://nextjs.org/docs/app/guides/environment-variables. Next.js documenta
  que las variables `NEXT_PUBLIC_*` se incrustan y quedan congeladas durante
  `next build`. Límite: validar el build evita una configuración ausente o
  insegura, pero no permite promover el mismo artefacto entre entornos con una
  URL distinta; para eso haría falta otro mecanismo de configuración runtime.

## BL-31 · Historial de versiones por campaña — *Claude, ajustada por ChatGPT*
**Estado: verificada y mergeada en PR #42 (`main@1db6944`, ChatGPT 2026-10-11).** Aceptada con ajuste; P2 después de cerrar E3. Auditoría: https://github.com/fermalenoski86/dev/pull/42#issuecomment-6105271159. CI exacta 38034544895: 7/7 jobs, 282/282 mutaciones, M2C 14/14 y `e2e-platform` 7/7.
Debate y aprobación de E3b:
https://github.com/fermalenoski86/dev/pull/36#issuecomment-6091297474.
- Problema: el aprobador sólo llega a una versión desde el enlace que entrega
  el operador; no puede recuperar el historial de una campaña desde la UI.
- Beneficio: navegación operativa y trazabilidad sin copiar enlaces fuera de
  TRUST.
- Ajuste del auditor: `GET /campaigns/:id/versions` devuelve resúmenes
  paginados, aplica la misma autorización por objeto que campaña/versión y no
  expone contenido innecesario. Debe ir en un cambio separado después de E3.
- Prioridad/esfuerzo: P2, ~0,5–1 día.
- Criterio: listado ordenado y paginado; pruebas negativas demuestran que un
  actor no puede enumerar campañas ni versiones ajenas; OpenAPI y UI quedan
  cubiertos por tests.
- Fuente primaria consultada 2026-10-09:
  https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization/.
  OWASP API1:2023 muestra que un endpoint de listado puede revelar
  identificadores que luego habilitan BOLA. Límite: la guía define el riesgo,
  pero el modelo concreto de permisos sigue siendo el contrato interno de
  TRUST.

---

# Propuesta de proceso P-01…P-05 — *Claude, 2026-10-11, pedido de Fer*

**Estado: aceptada con ajustes** (ChatGPT, [#53](https://github.com/fermalenoski86/dev/issues/53#issuecomment-6110866000), 2026-10-11). Claude acepta todos los ajustes sin discrepancia. Resumen de lo que cambia respecto del texto original:
- **P-01:** push a `main` **solo fast-forward** (`git push origin HEAD:main`), prohibido `--force` y `--force-with-lease`; ante avance concurrente: abortar, releer, reconstruir sobre el main nuevo, reintentar. CI valida ≤ 60 líneas, exactamente una pelota válida y ningún marcador de conflicto (`<<<<<<<`, `=======`, `>>>>>>>`). Pedir a Fer protección de rama `main` (CI requerido) cuando el plan lo permita.
- **P-02:** `PROGRESO.md` es reporte generado, no memoria. Distinguir `0/0 (sin entregables definidos)` de `0/N (definidos, pendientes)`; un test acredita solo lo que prueba; brief aprobado ≠ funcionalidad; PR sin AUDIT no cuenta; evidencia física con referencia, condiciones, fecha y responsable. Fuente **determinista** (manifiesto en el repo, sin consultas variables a la API en `progress:check`).
- **P-03:** scripts de CI/collab y cambios a gates/auth/transferencia de pelota son riesgo **alto**, no bajo; el riesgo se puede elevar a mano, nunca rebajar sin justificación revisada; el auditor decide siempre, también en bajo.
- **P-04:** sanitizar logs/trazas/artifacts (cookies, tokens, env, datos comerciales); cuarto estado `causa no determinada (en investigación)`; `2/2` prueba reproducibilidad, no causa raíz; ajustar timeouts/umbrales solo por decisión y auditoría explícitas con prueba de que sigue detectando el fallo.
- **P-05:** Claude **no toca `HANDOFF.md`** mientras la pelota es del auditor, ni la tabla "Abierto": el lateral se registra en su PR/issue y el titular de la pelota lo refleja después. Restricciones de push requieren branch protection, no solo el script.

Orden confirmado: P-01 → P-02 → P-05 → P-04 → P-03, un PR por ítem, F3(a) con precedencia.

Texto original de la propuesta: Nada de esto se implementa hasta el acuerdo de ChatGPT
(ajustar o descartar con motivo, ítem por ítem). No frena F3(a). Restricciones
de Fer: cambios chicos, separados y auditables; sin archivos de memoria nuevos;
estructura HANDOFF / DECISIONES / HISTORIAL intacta.

Orden propuesto: P-01 → P-02 → P-05 → P-04 → P-03. Cada uno es un PR propio,
auditado como cualquier otro.

## P-01 · Protección del HANDOFF (prioridad 1)
- **Problema observado:** el 2026-10-07 el PR #2 quedó en conflicto porque la
  rama y `main` editaron `HANDOFF.md` en paralelo. Hoy la regla "releer antes de
  escribir" es de buena voluntad; nada la hace cumplir.
- **Propuesta (dos piezas, sin archivos nuevos):**
  1. `scripts/collab/handoff.sh`: único camino para escribir `HANDOFF.md`.
     Hace `git fetch`, compara el SHA de `main` con el que el agente leyó al
     arrancar (`HANDOFF_BASE_SHA`, que el propio script imprime al leer),
     y si `main` se movió **aborta** y muestra el diff: el agente relee y
     reintenta. Después commitea y hace `git push` con
     `--force-with-lease=main:<sha leído>`, así un push concurrente del otro
     agente no se pisa nunca (el lease lo rechaza).
  2. CI (`gates.yml`, job `verify-build`): ≤ 60 líneas (ya está) + el
     archivo tiene exactamente una línea `**Pelota en:**` con valor `Claude`
     o `ChatGPT`, y sin marcadores de conflicto (`<<<<<<<`).
- **Esfuerzo:** 0,5 día. **Riesgo:** bajo (scripts + CI).
- **Criterio de aceptación:** test del script con dos escritores simulados
  sobre un repo bare local: el segundo aborta con mensaje claro y sin perder
  su cambio; con `main` quieto, escribe y pushea. CI falla con dos "Pelota en"
  o con un marcador de conflicto. AGENTS.md documenta el script como el único
  camino; los prompts de ambos agentes lo usan.

## P-02 · Progreso verificable (prioridad 1)
- **Problema observado:** "M3A.1 cerrada" es cierto para el software de
  gestión, pero Fer no tiene una vista que separe eso de lo que todavía no
  existe (NovaStar, DMX, reloj, hardware). Un porcentaje a ojo engañaría.
- **Propuesta:** `scripts/collab/progress.mjs` genera
  `docs/collab/PROGRESO.md` **a partir de datos existentes**, sin opinión:
  - **Fuente de entregables:** los briefs (`docs/briefs/*.md`, secciones
    "Checkpoints"/"Entregables") y `M3A1_ACEPTACION.md` (los 19 puntos §48
    ya tienen estado por test).
  - **Fuente de estado:** tags `[§N]` en tests (como hace `acceptance:check`),
    issues `AUDIT:` cerrados con `AUDIT: APROBADO`, PRs mergeados.
  - **Cinco pistas separadas**, una tabla cada una: Software de gestión
    (plataforma + platform-web) · Integración NovaStar/procesador LED ·
    DMX/Art-Net/iluminación · Reloj/cúpula · Hardware físico e instalación.
    Hoy las últimas cuatro muestran **0 entregables definidos**: eso es el
    dato, no se rellena.
  - **Tres columnas de verdad por entregable:** `código` (PR mergeado +
    AUDIT) · `probado simulado` (tests/CI) · `probado con equipo real`
    (requiere evidencia enlazada: nunca se marca desde el repo solo).
  - Solo **conteos** (n/N) por pista y columna. Nada de porcentaje global.
- **Esfuerzo:** 1 día. **Riesgo:** bajo (solo docs generados).
- **Criterio de aceptación:** `pnpm progress:check` falla en CI si
  `PROGRESO.md` no coincide con lo generado (misma regla que DELIVERY.md).
  Un entregable sin test ni AUDIT aparece como `pendiente`, nunca como hecho.
  La columna "equipo real" está vacía en todo el repo hoy y el documento lo
  dice en una línea. Nota a acordar: `PROGRESO.md` es un **archivo generado**
  (como DELIVERY.md), no un archivo de memoria; si ChatGPT lo considera
  violación de "sin archivos nuevos", alternativa: sección generada dentro de
  `DELIVERY.md`.

## P-03 · Auditoría basada en riesgo (prioridad 3)
- **Problema observado:** una corrección de typo en docs y una migración de
  DB reciben la misma auditoría. El tiempo del auditor es el cuello de botella
  (ronda cada 2 h).
- **Propuesta:** el PR declara `Riesgo: bajo | medio | alto` con una regla
  mecánica, no a criterio:
  - **alto:** toca `packages/platform-db/migrations`, `platform-auth`,
    `platform-approval`, storage, procesos externos (ffmpeg/ffprobe), CORS/CSRF,
    `apps/control` congelado, o cualquier cosa que mande señal a hardware
    (cuando exista).
  - **medio:** API, platform-web, show-engine, tests que son gate.
  - **bajo:** docs, scripts de collab, CI sin cambiar gates.
  - CI calcula el nivel desde los paths tocados y lo compara con el declarado
    (`scripts/collab/risk.mjs`); si el PR declara menos, falla.
  - **Todos los gates corren siempre.** Lo que cambia es el **mínimo de
    auditoría**: bajo = delta + CI; medio = lo de hoy; alto = lo de hoy +
    sección obligatoria "Pruebas adversarias" en el PR con al menos un caso de
    cada eje aplicable (permisos cruzados, concurrencia, fallo de
    infraestructura a mitad de operación, rollback, y, para control físico,
    "qué pasa si el comando llega dos veces / tarde / nunca").
- **Esfuerzo:** 1 día. **Riesgo:** bajo.
- **Criterio de aceptación:** el script clasifica correctamente los últimos
  10 PRs mergeados (tabla en el PR); un PR alto sin la sección adversaria
  falla en CI; AGENTS.md define los tres mínimos.

## P-04 · Diagnóstico de fallas (prioridad 2)
- **Problema observado:** en #26 tardamos dos días en separar "test con carrera"
  de "runner lento", y ni Claude ni ChatGPT pueden bajar logs/artifacts por el
  proxy: solo anotaciones.
- **Propuesta:** extender lo que ya existe (`scripts/ci/run.sh`, `gates.yml`):
  1. Todo job publica como anotación: SHA, `ImageOS/ImageVersion`, versiones
     de Node/pnpm/Chrome/ffmpeg/PostgreSQL, y la cola del error. Hoy solo lo
     hace e2e-m2c.
  2. `test-results/` como artifact al fallar, en todos los jobs (hoy solo
     e2e-m2c).
  3. Clasificación obligatoria al comentar una falla en el PR, con tres
     valores y su prueba: **regresión reproducible** (falla 2/2 en el mismo
     SHA o en local) · **intermitente** (pasa y falla en el mismo SHA; se
     abre/actualiza un issue `flaky` con la tabla run/SHA/región, como #26) ·
     **infraestructura** (el error es del runner/red/paquete, con la línea
     que lo prueba). Sin clasificación no se pide re-auditoría.
  4. Prohibido explícito en AGENTS.md: `retries > 0`, subir timeouts, bajar
     umbrales o `skip` para que algo pase. Ya es la práctica; se escribe.
- **Esfuerzo:** 0,5 día. **Riesgo:** bajo.
- **Criterio de aceptación:** una falla provocada en cada job deja la
  anotación con entorno y cola; `rg "retries:" playwright.config.ts` sigue
  en 0; un comentario de falla sin clasificación es hallazgo P2 del auditor.

## P-05 · Trabajo paralelo controlado (prioridad 2)
- **Problema observado:** cada 2 h uno de los dos espera. Ya se hizo en la
  práctica (#40/#41 mientras E3c estaba en auditoría) y funcionó, pero sin
  regla escrita: riesgo de tocar el PR auditado o de mergear sin AUDIT.
- **Propuesta:** en AGENTS.md, sección "Paralelo":
  - Mientras la pelota está en ChatGPT, Claude puede trabajar **solo** en
    ítems de BACKLOG con estado `aceptada` y riesgo bajo/medio (P-03), en rama
    propia desde `main`, **sin tocar la rama bajo auditoría ni `HANDOFF.md`**
    salvo la tabla "Abierto" (una línea por PR lateral).
  - Un PR lateral **nunca** se mergea sin `AUDIT: APROBADO` propio, y nunca
    antes del PR de la fase si comparten archivos.
  - CI: si un push toca la rama de un PR cuyo HANDOFF dice "en auditoría"
    (`scripts/collab/handoff.sh` lo sabe), el script de P-01 lo bloquea.
- **Esfuerzo:** 0,25 día (docs) + la regla en el script de P-01.
- **Criterio de aceptación:** AGENTS.md lo define; el script rechaza un push
  a la rama auditada; HISTORIAL muestra un lateral completo sin tocar la fase.

## Lo que NO propongo
- Un tercer agente permanente. El cuello de botella es el **ciclo de 2 h**, no
  la capacidad: se resuelve con P-05 (paralelo) y P-03 (menos auditoría a lo
  trivial). Un auditor externo **puntual** (como Fable en #26) sí sirve: para
  seguridad antes de producción y para hardware cuando exista. Se pide por
  issue `decisión-producto`, no se automatiza.

---

# P-06 · TRUST Agent Bridge — Zero Cost — *Claude, 2026-10-11, pedido de Fer*

**Estado: aceptada con ajustes, solo diseño + PoC** (ChatGPT, [#54](https://github.com/fermalenoski86/dev/issues/54), 2026-10-11). Claude acepta todos los ajustes. Lo que queda acordado:
- **Alternativa 2 es la base operativa.** La 3 es experimental, detrás de PoC-0 y PoC-1, y **no** se habilita con permisos de escritura hasta volver a #54 con evidencia.
- **Regla crucial:** ninguna salida automática (review de Codex, comentario de bot, ausencia de P0/P1) se convierte en `AUDIT: APROBADO`. El veredicto formal y el merge siguen siendo del auditor en el flujo actual. El puente **notifica y propone**, no aprueba.
- Guardas: concurrency por repo+PR; validar en runtime repo, PR, rama, SHA, estado, emisor autenticado y transición esperada (no `body.includes('AUDIT:')`); nunca `pull_request_target` con checkout del PR y secretos; a la 5.ª ronda `bridge-paused`, no `decisión-producto`; el lock cron/Action debe ser atómico y con vencimiento (una línea en HANDOFF no es un mutex); la Action nunca mergea ni escribe `main`.
- PoC-0: 3 PRs aislados (inocuo / P1 sembrado reversible / P2 inocuo), medir review tras abrir y tras push, latencia, cuota; probar `@codex review` desde una GitHub App. **Sin presumir** que el review empiece con `AUDIT:`.
- PoC-1: `issue_comment` y `pull_request_review` por separado; permisos mínimos; probar PR ajeno, comentario externo, fork, replay, fallo de cuota.
- Criterios: registrar SHA, ID de evento, actor, run, timestamp, cuota; 0 secretos en logs/artifacts/commits; 0 pushes a main; 0 aprobaciones por silencio; invalidación con HEAD viejo; rollback verificado; F3(a) intacta.
- **Dato nuevo (2026-10-11 16:18 UTC):** `chatgpt-codex-connector[bot]` respondió solo en #54 ("To use Codex here, create an environment for this repo" → https://chatgpt.com/codex/cloud/settings/environments). Confirma que el conector está instalado y escucha menciones `@codex` también en **issues**; falta que Fer cree el environment (gratis). Es el prerrequisito de PoC-0.
- **Humano, una sola vez (Fer):** crear el environment de Codex para `fermalenoski86/dev`; encender *Automatic review* si aparece; más adelante, para PoC-1, `claude setup-token` → GitHub Secret `CLAUDE_CODE_OAUTH_TOKEN`.

Texto original de la propuesta: Investigación con fuentes primarias (fecha de consulta
2026-10-11). Nada se implementa hasta acuerdo con ChatGPT. Condición de Fer:
**USD 0 adicionales** (sin API paga, sin servidor, sin suscripción nueva).

## Qué comprobé sobre cómo se despierta cada agente (sin suponer)

| Agente | Mecanismo | Verificado | Fuente |
|---|---|---|---|
| Claude (turnos actuales) | Tarea programada cron en la nube de Claude | **Mínimo 1 hora**: probé crear `*/30` y el sistema lo rechaza ("the minimum interval is 1 hour"). No hay webhook ni endpoint para dispararla desde GitHub. | prueba directa, hoy |
| Claude (GitHub Action) | `anthropics/claude-code-action@v1` en un workflow del repo. Se activa con `@claude` en un comentario de issue/PR (modo interactivo) o con un `prompt` fijo en cualquier evento de GitHub (modo automático). Autenticación con **`CLAUDE_CODE_OAUTH_TOKEN`** generado con `claude setup-token`: "available on Pro, Max, Team, and Enterprise plans"; "runs use your Claude subscription instead of API billing". Guardado como **GitHub Secret** (no en el repo). Rechaza actores bot salvo `allowed_bots` (anti-bucle). | doc oficial | https://code.claude.com/docs/en/github-actions · https://github.com/anthropics/claude-code-action/blob/main/docs/setup.md |
| ChatGPT/Codex (GitHub) | Comentario **`@codex review`** en un PR → revisión; **Automatic review** en Codex settings → revisa sin comentario (el evento exacto lo elige "Review trigger"). Sigue las reglas de `AGENTS.md` ("Codex searches your repository for AGENTS.md files and follows the applicable code review rules", sección `## Code Review Rules`). Publica **solo P0 y P1**. `@codex <otra cosa>` abre un chat cloud con el PR como contexto. **No documentado:** reacción a comentarios en issues (no PR) ni a comentarios de cuentas bot. | doc oficial | https://developers.openai.com/codex/integrations/github.md (redirige a learn.chatgpt.com/docs/third-party/github.md) |
| ChatGPT (turnos actuales) | Tarea programada que Fer configuró en ChatGPT, cada 2 h | Funciona hoy; su mínimo lo conoce Fer | — |
| GitHub Actions | Repo **público** → minutos ilimitados gratis para runners estándar | ya lo usamos (gates.yml) | docs GitHub billing |

**Consecuencia:** la sesión en la nube de Claude que corre hoy **no** puede
ser despertada por GitHub. Pero existe **otro runtime de Claude** (la Action)
que sí es por eventos y usa la suscripción. Codex sí puede ser despertado por
un evento de PR. Eso hace viable la alternativa 3, con límites.

## Alternativa 1 · GitHub Actions + notificaciones (avisar, no ejecutar)
- **Arquitectura:** workflow `bridge-notify.yml` en `main`, sobre eventos
  `issue_comment`, `pull_request`, `push` a `main` (HANDOFF). Detecta `AUDIT:`,
  PR abierto, "Pelota en:" cambiado. Publica una **anotación** y, si Fer lo
  quiere, un issue/label `pelota:claude` / `pelota:chatgpt` (visible en la app
  de GitHub del celular; notificaciones de GitHub, gratis).
- **Funcionamiento:** nadie se despierta; el turno de 2 h sigue, pero el que
  llega ya encuentra la señal lista y no tiene que leer todo.
- **Costo:** 0. **Humano:** 0 (opcional: Fer mira el label).
- **Limitaciones:** no baja la latencia por sí sola.
- **Latencia entre entregas:** la de hoy (≤ 2 h por lado).

## Alternativa 2 · Puente semiautomático (lo que ya tenemos, mejor usado)
- **Arquitectura:** (a) **turno de chequeo** de Claude cada hora en :26
  (mínimo permitido), de solo lectura: si hay `AUDIT:` nuevo o la pelota
  cambió, ejecuta el turno completo ahí mismo; si no, termina en segundos.
  (b) Codex con **Automatic review** encendida: cuando Claude abre o actualiza
  un PR, Codex lo revisa en minutos sin esperar las :56 pares. Su turno de 2 h
  queda como respaldo y para lo que no es PR (briefs, issues).
- **Funcionamiento:** Claude entrega → Codex revisa en minutos → Claude lo ve
  en ≤ 1 h → corrige → Codex revisa en minutos.
- **Costo:** 0 (la revisión automática está dentro del plan que Fer ya usa;
  confirmar en Codex settings que la opción aparece).
- **Humano:** una vez: Fer enciende "Automatic review" y elige "Review trigger".
- **Limitaciones:** la revisión automática de Codex es **P0/P1 y formato de
  review de GitHub**, no el protocolo `AUDIT: APROBADO/CAMBIOS` completo. Hay
  que escribir el protocolo en `AGENTS.md` bajo `## Code Review Rules` y
  verificar en la PoC que lo respeta. Codex no reacciona a issues: los briefs
  siguen en el turno de 2 h.
- **Latencia entre entregas:** de ~4 h por ronda a **~1 h** (dominada por el
  chequeo horario de Claude).

## Alternativa 3 · Puente completamente automático (eventos → agentes)
- **Arquitectura:**
  ```
  Claude (Action) abre/actualiza PR ──► Codex Automatic review (minutos)
        ▲                                     │ review con "AUDIT: CAMBIOS"/"APROBADO"
        │ issue_comment / pull_request_review │ (cuenta de Fer = actor humano ✔)
        └──── claude-code-action@v1 ◄─────────┘
              prompt fijo: "sos el implementador, leé AGENTS/HANDOFF/DECISIONES,
              respondé esta auditoría"; CLAUDE_CODE_OAUTH_TOKEN en Secrets
  ```
  El turno cron de 2 h de Claude queda como **respaldo manual** y para
  tareas largas; la Action hace lo corto (responder hallazgos, pedir
  re-auditoría, mover la pelota con el script de P-01).
- **Costo:** 0 adicional: minutos de Actions gratis (repo público), token de
  suscripción (consume la cuota del plan de Fer, no USD), Codex dentro del
  plan actual.
- **Humano:** una vez: Fer corre `claude setup-token` en su máquina y pega el
  token en GitHub → Settings → Secrets (nunca en el repo); enciende Automatic
  review en Codex. Después: solo `decisión-producto`.
- **Limitaciones reales (no suposiciones):**
  1. Codex revisa **PRs**, no issues: los briefs documentales (como F3(a) en
     #50) sí son PRs, así que entran. Lo que no es PR cae al turno de 2 h.
  2. Codex publica P0/P1 en formato review; el veredicto `AUDIT:` depende de
     que acate `AGENTS.md`. **Hay que probarlo** (PoC).
  3. `claude-code-action` rechaza actores **bot**. Los comentarios de Codex
     llegan con la cuenta de Fer (humano) → disparan. Los de la Action llegan
     como app → **no** disparan a la propia Action (anti-bucle gratis). Si
     Codex ignora comentarios de bots, el flujo igual cierra porque Codex
     reacciona al **push** del PR, no al comentario.
  4. Un job de Actions no tiene PostgreSQL ni ffmpeg listos: para gates
     completos la Action **no corre tests**, espera a `gates.yml` (ya existe)
     y lee su resultado por API. Evita duplicar 20 min de CI.
  5. Cuota de la suscripción: un turno de la Action gasta lo que un turno
     normal. Con `--max-turns 40` y un timeout de 45 min por job se acota.
  6. Token: `setup-token` da un token de larga vida; si vence, la Action
     falla ruidosamente (rojo), nunca silenciosamente.
- **Guardas anti-bucle y anti-duplicado (obligatorias):**
  - `concurrency: { group: bridge-${{ github.event.issue.number }}, cancel-in-progress: false }`;
  - **máximo 4 rondas AUDIT por PR** contadas por la Action; a la 5.ª no
    responde: etiqueta `decisión-producto` y para (regla ya vigente de
    "dos rondas sin acuerdo", endurecida);
  - la Action solo actúa si `HANDOFF.md` en `main` dice `Pelota en: Claude`
    **o** el comentario es un `AUDIT:` nuevo; si la pelota es de ChatGPT y no
    hay AUDIT nuevo, sale sin hacer nada;
  - el cron de 2 h **lee** la misma línea "trabajo en curso" de P-01: si la
    Action ya tomó el PR hace < 60 min, el cron termina con "sin novedades";
  - la Action **nunca mergea**: solo responde, corrige en la rama de la fase,
    pide re-auditoría. El merge sigue siendo del turno cron tras
    `AUDIT: APROBADO` + gates verdes (regla intacta).
  - **nunca** toca una rama que `HANDOFF.md` marque "en auditoría" (P-05).
- **Latencia entre entregas:** **minutos** por ronda (Codex ~2–10 min, Action
  ~5–20 min según el trabajo). De ~4 h a ~15–30 min.

## Recomendación
**Alternativa 3 con la 2 como respaldo**, en este orden, cada paso un PR
auditado:
1. **PoC-0 (sin tocar el flujo real, 1 h):** PR de prueba `poc/bridge` con un
   cambio trivial. Fer enciende Automatic review. Medimos: ¿Codex revisa solo?
   ¿en cuánto? ¿respeta una regla `## Code Review Rules` que le pide abrir con
   `AUDIT: APROBADO`/`AUDIT: CAMBIOS`? ¿reacciona a un `@codex review` escrito
   por la Action (bot)? Resultado en el issue, con tiempos.
2. **PoC-1 (1 h):** workflow `bridge-claude.yml` en modo automático sobre
   `issue_comment` que contenga `AUDIT:`, con `prompt` de solo lectura:
   "resumí el hallazgo en un comentario; no toques código". Token en Secrets.
   Medimos latencia y que **no** se dispare con sus propios comentarios.
3. **Si 1 y 2 pasan:** PR del puente real (prompt del implementador acotado,
   guardas de arriba, P-01 como única vía de escritura del HANDOFF). Si Codex
   **no** respeta el formato `AUDIT:`, nos quedamos en la alternativa 2 y el
   turno de 2 h de ChatGPT sigue siendo el que pone el veredicto.
4. Alternativa 2(a) (chequeo horario de Claude) se hace **igual** en todos los
   casos: es gratis y no depende de nadie.

## Criterios verificables de aceptación
- PoC-0: tabla con 3 PRs de prueba → tiempo hasta review de Codex, y si el
  texto empieza con `AUDIT:`. Sin eso, la alternativa 3 queda descartada con
  evidencia, no con opinión.
- PoC-1: 3 comentarios `AUDIT:` → 3 respuestas de la Action en < 15 min; 3
  comentarios de la propia Action → 0 disparos; un comentario de un tercero
  sin permisos de escritura → 0 disparos (chequeo de "write access" de la Action).
- Puente real: una ronda completa (CAMBIOS → corrección → re-auditoría →
  APROBADO) en < 60 min sin intervención de Fer, con HANDOFF consistente al
  final (`Pelota en:` único, ≤ 60 líneas) y 0 merges automáticos.
- Bucle: prueba provocada con 5 rondas → la 5.ª termina en `decisión-producto`.
- Respaldo manual: apagar el workflow (`gh workflow disable`) devuelve el
  flujo exactamente al de hoy, sin otro cambio.
- Secretos: `git log -p | rg -i "oauth|sk-ant"` vacío; el token solo en
  Settings → Secrets.
- F3(a): ningún PR de P-06 toca `fase/f3a` ni espera a su cierre.

## Lo que NO es gratis y por eso se descarta
Un servidor propio o un webhook externo para despertar la sesión en la nube
de Claude (no existe endpoint; habría que pagar hosting), la API de Anthropic
o de OpenAI por uso, y cualquier "bot" de terceros con suscripción.


---

# CS · TRUST CREATIVE STUDIO — *pedido de producto de Fer, 2026-10-11 ([#59](https://github.com/fermalenoski86/dev/issues/59))*

**Estado: aceptada (encargo de Fer). Ahora solo CS-0 (brief, PR documental + AUDIT).** Implementación de CS-1…CS-4 después de cerrar F3(a) y con briefs acordados. No toca `apps/control` ni storage congelados.

- **Qué es:** editor de takeovers (15 s y otras duraciones) con timeline multipista, 3D anamórfico, efectos, simulación de dos pantallas LED, fachada RGBW DMX/Art-Net y reloj. Inspiración disguise/Resolume/Blender/Unreal, sin copiar código ni interfaces.
- **Usuario:** hoy el equipo propio (pruebas); después, marketing del cliente que alquila el espacio. Esto define que el editor sea simple con plantillas y que **todo lo exportado entre por el pipeline normal** (validación B2, cuatro ojos, versión/hash).
- **Reglas que ya fija el encargo:** el gemelo digital actual es **PRELIMINAR** (GLB no medido); rotular SIMULADO / PRELIMINAR / CALIBRADO / VALIDADO EN SITIO; geometría y formatos configurables; el software creativo **nunca** publica ni ejecuta (eso es EDGE); dos controladoras independientes; sin servicios pagos.
- **Posición de Claude (2026-10-11):** (1) arquitectura: editor web liviano (reusar `trust-3d`, `show-engine`, Builder, preflight), **produce ShowPackages**, render pesado en **Blender** headless; empaquetable como app de escritorio (Tauri/Electron) sin cambiar la base; (2) **calibración del gemelo como unidad propia y temprana (CS-1b)**: fotos desde el Obelisco con posición conocida + una cota real; sin eso CS-2 no se valida; (3) la oferta P5 del 10/10 (dos caras 1728×768) contradice el modelo `EL_TRUST` → issue [#61](https://github.com/fermalenoski86/dev/issues/61); hasta decidirlo, formatos configurables.
- **Siguiente:** brief **CS-0** en PR documental (lateral, rama propia) → AUDIT → recién después discutir orden CS-1 vs UI de F3(a).
