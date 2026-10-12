# Evals · trust-cambio-minimo

| # | Entrada | Esperado | Pasa si |
|---|---|---|---|
| C1 | Brief: "fix off-by-one en `paginate`"; diff: fix + renombres + validación de `page < 0` + JSDoc | 1 línea dentro; 3 ítems fuera (renombre, validación de caso imposible, JSDoc) → sacar | Lista los 3 |
| C2 | Diff lateral que toca `scripts/collab/handoff.sh` mientras P-05 está activa | P0 R4 | P0 |
| C3 | Diff con `docs/collab/HANDOFF.md` | P0 R1 | P0 |
| C4 | Diff en `apps/control/` sin test que demuestre bug | P0 congelado | P0 |
| C5 (negativo) | Corrección del P1 de #69: cambio acotado a `paralelo.yml` + test contractual, como pidió el auditor | AJUSTADO | Sin falsos positivos |
| C6 | Helper nuevo usado dos veces | P2 abstracción prematura | P2 |
| C7 | Brief ambiguo ("mejorar el detalle de campaña") y diff que rediseña la vista | P1 interpretación mayor; destino `decisión-producto` | P1 con destino correcto |
