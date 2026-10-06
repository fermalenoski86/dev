# M2C.1.2 — Final Release Gate

**420 tests · mutation check 73/73 · E2E real 2 passed / 0 failed ·
artefactos intactos tras el mutation check.**

Gate completo ejecutado en el orden pedido. Salida en `M2C12_SALIDA.txt`,
screenshots en `docs/screenshots/`.

---

## Chromium real: cómo se resolvió

El entorno no tiene navegador y los CDN de Playwright no están en el allowlist.
Pero el **registro npm sí**, y hay paquetes que traen el binario adentro:

1. `npm pack @sparticuz/chromium` → 67 MB con `chromium.br`;
2. descompresión brotli → Chromium 153 en `/opt/trust-chromium`;
3. crasheaba en `SkFontMgr_FontConfigInterface: Not implemented` — se resolvió
   instalando `fontconfig` y fuentes desde **archive.ubuntu.com**, que también
   está permitido;
4. Playwright lo usa vía `executablePath`.

`playwright.config.ts` lee `TRUST_CHROMIUM_PATH`: si no está, usa el Chromium
que instala `playwright install`. Playwright sigue **fuera del lockfile**.

## 1 · El mutation check ya no contamina artefactos

**Tu diagnóstico no era preventivo: ya había pasado.** Al separar el generador
encontré que `docs/examples/README.md` decía **BLOCKED** con dos
`PLAY_WITHOUT_MEDIA`. Ese README **se entregó así en el ZIP de M2C.1.1**:
escrito por un mutante mientras `preflight` estaba alterado.

De paso apareció un segundo defecto: al mover el archivo, `__dirname` cambió y
el generador escribía en `/home/docs/examples`, fuera del repo, sin fallar.

Corrección:

- `scripts/emit-examples.emit.ts` + `vitest.emit.config.ts` (include
  `scripts/**/*.emit.ts`). `pnpm test` no lo incluye, así que **ningún mutante
  lo ejecuta**;
- `pnpm emit:examples` como comando aparte;
- `packages/show-authoring/src/artifacts.test.ts`, **puro**, que compara el JSON
  del repo contra lo que compila el preset. Si alguien lo edita a mano o un
  mutante lo reescribe, falla;
- test del `README.md` entregado: tiene que decir READY y «preflight errores |
  ninguno».

**Verificación del gate:** `md5sum` de los tres artefactos antes y después del
mutation check → los tres `OK`.

**Test puro pedido:** `A+B en un mediaGroup con ambas reproduciendo NO da
PLAY_WITHOUT_MEDIA`. Comprueba que `media.screen_a` y `media.screen_b` no
existen, que el grupo `towers` los contiene, que ambas tienen `media.play`, y
que preflight no emite el código — porque la regla mira la fuente **resuelta**,
no el diccionario `media`.

## 2 · Selectores de assets reales

El spec usaba `getByTestId('surface-horizontal').selectOption(...)` sobre el
`<g>` del SVG. Agregué `asset-master-select`, `asset-corrientes-select`,
`asset-pellegrini-select` y `asset-horizontal-select`, y el test provoca el
mismatch asignando el master de torres (2592×576, aspecto 4.5) a la horizontal
(1920×412, 4.66).

## 3 · Locators únicos

`moment-duration` existe una vez por moment. El test ahora selecciona el moment
y usa `moment-duration-field`, el campo único de PROPERTIES, con
`toHaveCount(1)` como guarda. Corregido en los dos tests.

## 4 · Aserción real de guardado

`data-testid="save-state"`, **siempre presente**, con `SAVED` / `UNSAVED`. Se
muestra siempre y no solo cuando está sucio a propósito: un test no puede
afirmar sobre la ausencia de un cartel, porque la ausencia también ocurre
cuando la UI no cargó. El test verifica `UNSAVED` → Guardar → `SAVED`.

## 5 · STOP nunca se bloquea

BLOCKED impide PLAY, RESTART, SCRUB, PRESENT y EXPORT. **STOP no.** Deshabilitar
STOP dejaría al operador mirando un preview corriendo sin forma de pararlo: que
un show no se pueda arrancar no implica que no se pueda parar.

Además `PreviewSession.enforce(validation)`, llamado desde `revalidate()`,
suelta el motor apenas el draft deja de ser previsualizable — antes `ensure`
solo corría en play/restart/scrub, así que un draft que pasaba a BLOCKED
**mientras reproducía** seguía sonando hasta el próximo comando.

Cubierto en los tests unitarios y en el E2E, que hace click en STOP con el draft
bloqueado y verifica `transport = stopped`.

## 6 · E2E real

```
Running 2 tests using 1 worker
  2 passed (5.8s)
```

Tres iteraciones hasta pasar, con fallas reales: faltaban testids en las
pestañas de navegación, el servidor servía un build viejo, `selectOption` no
acepta regex en `label`, y los dos locators sin scope.

## 7 · Gate final, en orden

```
1. pnpm install --frozen-lockfile   [exit 0]
2. pnpm verify                      [exit 0]   420 passed
3. pnpm build                       [exit 0]   previs ✓ · control ✓
4. mutation-check                   73/73 · artefactos OK (md5)
5. pnpm emit:examples               [exit 0]   READY · preflight ninguno
6. pnpm e2e                         2 passed · 0 failed
7. pnpm verify (cierre)             [exit 0]   420 passed
```

## Criterios de cierre de M2C.1

| | |
|---|---|
| preset McDonald's = READY | ✅ `preflight: READY`, 15.0 s, 5 moments |
| E2E real pasa | ✅ 2 passed / 0 failed en Chromium |
| STOP nunca bloqueado | ✅ unitario + E2E |
| artefactos no cambian durante mutation-check | ✅ md5 antes/después |

## Screenshots

`docs/screenshots/`: `01-builder.png` (Builder con el preset cargado),
`02-mcdonalds-ready.png` (PREFLIGHT READY) y `03-present.png` (modo PRESENT
reproduciendo, con los cinco moments y el aviso de que es simulación de
autoría).

## Nota sobre el entorno

El Chromium de `/opt/trust-chromium` **no está en el repo**: son 200 MB y sería
un binario sin trazabilidad dentro del código. `e2e/README.md` documenta cómo
reproducirlo. En una máquina normal alcanza con `pnpm dlx playwright install
chromium`.
