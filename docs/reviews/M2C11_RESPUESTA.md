# M2C.1.1 — Final Builder Gate

**416 tests (antes 388). Mutation check 73/73. `install --frozen-lockfile`,
`verify` y `build` con exit 0.**

Salida en `M2C11_SALIDA.txt`.

---

## Procedencia — otra vez

Igual que en M2C.1: al empezar, el gate **ya estaba implementado en el
contenedor**. `preview-session.ts`, `persistence.ts`, el store con
`engineRevision` y `e2e/builder.spec.ts` estaban fechados horas después de mi
entrega anterior, con otro usuario. No salieron de esta conversación.

No lo reescribí. Lo audité contra los cinco puntos, completé lo que faltaba y
arreglé un problema serio que encontré de paso.

## Estado encontrado

Los puntos 1, 2 y 3 estaban implementados y con tests que cubren exactamente
los criterios pedidos:

| Punto | Estado |
|---|---|
| 1 · revisión de engine | `showPackageRevision(pkg)` derivada del contenido + `PreviewSession`. Los dos tests obligatorios (PLAY → editar → RESTART / SCRUB) presentes |
| 2 · `canPreview` en el store | Guarda única, aplicada en play/restart/scrub/present. Test con `status BLOCKED` y `showPackage` **no nulo** |
| 3 · persistencia | Política A: `dirty=true` + autosave, con confirmación al cambiar de preset. Tests de import, preset y recarga |

La decisión de derivar la revisión **del contenido del paquete compilado** en
vez de un contador es la correcta: un cambio que no afecta al ShowPackage no
fuerza recarga, y cualquiera que sí lo afecte la fuerza sin que haya que
acordarse de incrementar nada.

## Lo que completé

**Punto 4 — el E2E estaba a medias.** El spec existía pero no había
`playwright.config.ts`, ni script, ni los `data-testid` que el propio spec
declaraba faltantes. Un suite que no puede ni intentar correr no es "script
preparado".

Agregué:

- los cinco `data-testid` que faltaban (`moment-block`, `moment-duration`,
  `preview-duration`, `surface-horizontal`, `timeline-scrubber`), más
  `moment-count`, `moment-duration-field` y `surface-corrientes` /
  `surface-pellegrini`;
- `data-output` en cada superficie del preview, con `live` / `hold` / `black`,
  para que el test afirme sobre el estado sin leer píxeles;
- `playwright.config.ts` con `webServer` que levanta el control solo;
- `pnpm e2e`, que usa `pnpm dlx` y **no toca el lockfile** — agregar Playwright
  como dependencia obligaría a todos a bajarlo para un suite que todavía no
  corre en CI;
- `e2e/README.md` con la tabla de selectores y qué esperar.

**Sigue sin ejecutarse.** No hay Chromium acá. Está escrito contra el código,
no contra un navegador: es probable que en la primera corrida haya que ajustar
esperas (el preview arranca con `requestAnimationFrame`) y alguna aserción de
texto.

## Un problema que encontré de paso, y no era menor

`pnpm verify` falló con un error de lint en `packages/telemetry/src/lifecycle.ts`:
`'now' is defined but never used`. Al mirarlo, el código decía:

```ts
acknowledge(key: string, now: number): boolean {
  …
  this.tracked.delete(key);   // ← reconocer BORRABA la alarma
```

**Eso es una mutación del mutation-check que quedó aplicada en el repo.** El
mutante "ack no borra" de M2A.2, vivo en el código fuente.

En M2A.3 le había puesto restauración con `atexit` y handlers de señal, pero
nada de eso corre ante `SIGKILL` — un `timeout -9` o el contenedor detenido. Ya
pasó dos veces.

Restauré la línea (416 tests en verde) y endurecí el script con un **diario en
disco**: antes de mutar escribe el original en `scripts/.mutation-journal.json`,
y `--restore` recupera. Lo verifiqué matando el script con `SIGKILL` real: el
repo quedó mutado, `--restore` lo dejó sano y los 416 tests volvieron a pasar.

Lo importante no es el script: es que **un repo puede quedar silenciosamente
mutado y pasar por bueno**. Si esa corrida hubiera terminado en un ZIP, habría
entregado un `acknowledge` que borra alarmas — justo lo que ADR-029 promete que
no pasa.

## Resultados

```
pnpm install --frozen-lockfile   [exit 0]
pnpm verify                      [exit 0]   416 passed · lint limpio · 9 typechecks
pnpm build                       [exit 0]   previs ✓ · control ✓
mutation-check                   73/73 atrapados
pnpm e2e                         NO EJECUTADO — sin Chromium
```

## Pendiente

**La primera corrida real del E2E**, que es lo único que cierra los 14 puntos
del criterio de aceptación de M2C.1. Todo lo demás está verificado en node.
