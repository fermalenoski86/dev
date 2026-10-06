# M2C.2 — Executive Client Experience

**450 tests · mutation check 77/77 · E2E real 4 passed / 0 failed ·
artefactos intactos tras el mutation check.**

Salida en `M2C2_SALIDA.txt`, screenshots en `docs/screenshots/`.

---

## Procedencia

Como en M2C.1 y M2C.1.1: el módulo **ya estaba implementado en el contenedor**
al empezar — `packages/experience-core`, `/experience`, el renderer ejecutivo,
el spec E2E y los seis screenshots, todo fechado después de mi entrega
anterior. No salió de esta conversación.

Lo audité, encontré tres problemas serios y los corregí.

## Lo que encontré: tres mutaciones vivas en el repo

`pnpm verify` falló con un error de lint en `persistence.ts`. Al mirarlo:

```ts
const parsed = safeParseTakeoverDraft(JSON.parse(raw));
return JSON.parse(raw) as TakeoverDraft;   // ← Zod salteado
```

Eso es el mutante «storage valida con Zod» aplicado: `loadDraft` devolvía el
JSON del localStorage **sin validar**, rompiendo la garantía de «no confiar en
JSON importado».

Auditando el resto con un verificador que comprueba, para cada regla del
mutation check, que el patrón ORIGINAL siga presente, aparecieron **tres
mutantes vivos a la vez**: ése, el de `validation.ts` (permitía exportar con
estado BLOCKED) y uno más que el diario sí tenía registrado.

**Causa:** había **dos procesos de mutation-check corriendo en paralelo**. El
diario se sobrescribe, no se fusiona, así que el segundo proceso borró el
registro del primero y su mutación quedó viva y sin rastro.

Correcciones:

- **lock exclusivo** en `scripts/mutation-check.py`. Un segundo proceso sale
  con código 2 y un mensaje claro; si el lock quedó huérfano porque el proceso
  murió, restaura antes de arrancar. Probado lanzando dos corridas a la vez.
- **verificador de integridad**: recorrer las 77 reglas y comprobar que cada
  patrón original esté en su archivo. Es la forma barata de saber si el repo
  está limpio, y es lo que usé para encontrar los tres.

Aprendizaje operativo adicional: **los procesos en segundo plano no sobreviven
entre turnos**. Una corrida lanzada y no esperada muere a mitad y deja el repo
mutado. Por eso el lock detecta el huérfano.

## Un error mío, que el mutation check destapó

Al restaurar `validation.ts` a mano dejé el ternario duplicado:

```ts
errors.length > 0 ? 'BLOCKED' : errors.length > 0 ? 'BLOCKED' : …
```

El comportamiento era correcto, así que ningún test lo notó — pero el mutante
quitaba una rama y la otra seguía cubriendo, de modo que **«BLOCKED bloquea
export» sobrevivió**. No era un hueco de tests: era mi restauración sucia. Lo
limpié y el mutante volvió a quedar atrapado (4 tests fallan con él aplicado).

Es un buen argumento para no restaurar mutaciones a mano: para eso está
`--restore`.

## Un defecto de la experiencia, corregido

La end card se dibujaba con `bg-black/92` sobre el renderer. Las superficies
oscuras se veían a través como **bloques sólidos que cortaban el texto** y
tapaban a medias el badge `PLANNED CAPABILITY` de MEASUREMENT.

Un panel técnico con eso es un detalle; **una pantalla que se le muestra a
dirección de McDonald's, no**. Agregué `backdrop-blur-xl` y subí la opacidad,
en la end card y en el panel WHY. Screenshot 04 regenerado.

## Estado contra el pedido

| | |
|---|---|
| `/experience` como ruta propia | ✅ compila como página estática |
| `ExecutivePresentationRenderer` sin GLB ni 3D | ✅ recibe estado, no lo resuelve |
| ShowEngine única autoridad | ✅ testeado |
| Cambio de vista sin reiniciar | ✅ `setView` es puro sobre el estado |
| Cinema mode, END CARD, BEFORE/TAKEOVER, brand moments | ✅ |
| READY TO PRESENT antes de habilitar PLAY | ✅ testeado |
| DEMO RESET + atajos R / SPACE / ESC | ✅ |
| Offline: sin URLs http/https | ✅ test dedicado |
| STOP siempre accesible | ✅ |
| HOW IT WORKS → Builder | ✅ E2E lo verifica |
| Transparencia «CAMPAIGN PREVIEW · visualización conceptual» | ✅ visible en la home |

Los assets del hero son **placeholders**, no fotografías del edificio: están en
`apps/control/public/experience/` y se reemplazan sin tocar código.

## Resultados

```
pnpm verify                        [exit 0]   450 passed
pnpm build                         [exit 0]   previs ✓ · control ✓ · /experience 5.81 kB
mutation-check                     77/77 · artefactos OK (md5 antes/después)
pnpm e2e                           4 passed · 0 failed (builder 2 + experience 2)
pnpm verify (cierre)               [exit 0]   450 passed
```

## No entregado

**El video de la corrida de 15 s.** Puedo sacar screenshots pero no grabar
pantalla: Playwright tiene `recordVideo`, que genera `.webm`, y no lo probé en
este entorno. Si lo querés para la reunión, es un pedido chico y acotado.
