# CS-0A — Addendum de producto de TRUST Creative Studio

**Estado:** entregado para revisión (lateral documental; no interrumpe P-06/#98 ni toca la fase activa).

- **Origen:** decisión de producto de Fer del 2026-10-22, ampliación formal de [#59](https://github.com/fermalenoski86/dev/issues/59) y de `CS0_CREATIVE_STUDIO.md` (#74, `main@3b59b10`).
- **Rama:** `docs/cs0-addendum`.
- **Salida real:** `CS0A_SALIDA.txt`.

## Qué se entrega

| Archivo | Qué |
|---|---|
| `docs/briefs/CS0A_ADDENDUM_PRODUCTO.md` | Los 14 puntos pedidos: addendum (§1), arquitectura (§2), mapa UX (§3), roles (§4), Command System (§5), Campaign/Variant/Brand Space (§6), qué entra al core (§7), roadmap CS-1…CS-10 (§8), riesgos (§9), qué puede empezar ya (§10), MVP Desktop (§11), MVP Marketing (§12), Mobile/Tablet (§13), criterios medibles + design system (§14); más plugins (§15) y preguntas ❓A–❓F (§16) |
| `docs/reviews/CS0A.md`, `CS0A_SALIDA.txt` | Este reporte y la salida real de los gates |

No hay código, tests, rutas, variables de entorno, CI, `HANDOFF.md` ni partes congeladas en el diff. **No abre implementación.**

## Decisiones tomadas en el addendum (a confirmar por Fer)

- Se mantienen todas las de CS-0: un solo motor, Studio sin hardware, IA tipada, geometría preliminar, SHOW PACKAGE v1 sin cambios, Electron + TS + Three.js + Blender externo.
- Command System dentro de `creative-core` (CS-1), con `CreativePlan` de vocabulario cerrado traducido a comandos por una función determinista: la IA y el humano usan el mismo bus.
- TECH CHECK → APPROVED **es** el submit + cuatro ojos existente; MARKETING/BRAND REVIEW viven en el Studio (CS-7) y no tocan `platform-approval`.
- Roles del Studio adicionales y aditivos; `platform-auth` sigue siendo la única autoridad (❓A si Fer prefiere roles nuevos ahí).
- Variantes como overrides (comandos) sobre la campaña madre, con rebase explícito; hacia TRUST cada variante es campaña/versión propia (❓B).
- Orden propuesto: CS-1 → CS-1a → CS-2 (desktop) → CS-3 → CS-6 (marketing) → CS-5 → CS-7 → CS-4 → CS-9 → CS-8 → CS-10 (❓C).

## Qué no se promete

Validación jurídica de guidelines, anamorfosis antes de CS-1b, publicación en hardware, colaboración concurrente antes de CS-5, otros sitios además de EL TRUST, costos nuevos sin autorización.

## Riesgo declarado

`Riesgo: medio` (brief + salida de gates). La línea de registro en `BACKLOG.md` (sección CS) **no va en este PR**: `BACKLOG.md` lo toca la fase activa #98 (regla P-05, check `paralelo` exit 7); la agrega el titular de la pelota en el próximo turno, con el texto propuesto en el PR. Gates: `git diff --check`, `progress:check` y `acceptance:check` verdes en local; `pnpm verify` y el resto corren en CI sobre el HEAD del PR.
