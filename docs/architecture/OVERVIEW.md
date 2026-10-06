# TRUST PLATFORM — Arquitectura

## Los tres productos

```
┌─────────────┐   show package   ┌─────────────┐   firmado   ┌─────────────┐
│ TRUST PREVIS│ ───────────────► │TRUST CONTROL│ ──────────► │ TRUST EDGE  │
│ digital twin│                  │  cloud/ops  │             │ red local   │
└─────────────┘                  └─────────────┘             └──────┬──────┘
      hoy                          fase 2                    fase 3 │
                                                                    ▼
                                                        procesadores LED + DMX
```

El SHOW PACKAGE es el contrato que los une. El mismo archivo JSON que hoy
reproduce PREVIS en un navegador tiene que ejecutarlo mañana EDGE contra
hardware real, sin traducciones intermedias.

## Capas

```
apps/previs           UI. Solo pinta. Cero lógica de timeline.
  └─ state/           Zustand: puente entre motor y React.

packages/trust-3d     Digital twin R3F. Geometría por datos.
packages/show-engine  Motor. state(t) = fold(initial, eventos ≤ t).
packages/timeline     Transporte puro. Reloj inyectable.
packages/shared-types Contratos Zod. Fuente de verdad de los IDs.
```

Dependencias en una sola dirección:
`shared-types ← timeline ← show-engine ← trust-3d ← previs`. Nada apunta para arriba.

## La decisión central: recalcular en vez de avanzar

```ts
state(t) = fold(initialState, eventos.filter(e => e.atMs <= t))
```

Un motor que muta estado incrementalmente frame a frame se desincroniza al
seekear: hay que "deshacer" eventos, y deshacer no siempre es posible
(¿cómo deshacés un fade a medio camino?).

Recalculando desde el inicio, el seek es correcto por construcción. Llegar a
t=26s reproduciendo y saltar directo a t=26s dan exactamente el mismo estado,
y eso está testeado.

Coste: O(n) sobre los eventos del show. Con timelines de 30 segundos y decenas
de eventos es ruido. Si algún día hay shows con decenas de miles de eventos, se
indexa por keyframes — pero recién ahí.

**Por qué importa para el negocio:** es lo que permite que un operador retome un
show a mitad, que CONTROL sincronice dos edificios, y que una campaña se
previsualice en el segundo exacto que el cliente quiere ver.

## Orden de eventos

Orden total estable: `(atMs, índice de declaración)`. Dos eventos en el mismo ms
se aplican en el orden en que están escritos en el archivo. Determinista y
predecible para quien programa el show.

## IDs estables

`screen_a`, `dome`, `hero_3d` y compañía son contrato público. Cambiar uno rompe
todos los show packages ya publicados. Cualquier cambio exige bump de `version`
en el ShowPackage y una migración.

## Lo que deliberadamente NO está

Art-Net, DMX, APIs de procesadores LED, relés, cámaras IP, analytics, auth,
cloud, pagos, programmatic, app móvil. Todo eso entra después de validar que el
concepto de PREVIS cierra.
