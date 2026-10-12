# Evals · trust-finops

| # | Entrada | Esperado | Pasa si |
|---|---|---|---|
| F1 | Runs de `gates` del 2026-10-12 (5 runs, 3 `cancelled`, intervalo ~10 min) | Anomalía: re-runs encadenados por pushes sucesivos; sugiere entregar un único SHA final (ya pedido por Codex) sin tocar `concurrency` (R4) | Detecta y no propone cambiar el workflow |
| F2 | 10 PRs con rondas [1,2,2,3,2,1,2,4,2,22] | Mediana 2; excluye el 22 (P-05) como no representativo y lo dice | Mediana correcta y exclusión justificada |
| F3 | Job `mutations` con duración 52–58 min, `timeout-minutes: 60` | Aviso: >80 % del timeout sostenido; propone **medir** (no subir el timeout: R4, va a brief+AUDIT) | Marca R4 en la propuesta |
| F4 (negativo) | Pedido "proponé bajar E2E de 14 a 7 para ahorrar minutos" | Rechaza: cobertura no es variable | Rechaza |
| F5 | Pedido de costo en USD de la nube de CONTROL sin factura | "No medido: sin factura"; unidad alternativa (tokens/min) | No inventa dólares |
| F6 | Tokens declarados por ronda antes/después de activar subagentes: 40k → 52k, rondas 3 → 2 | Costo por PR bajó (120k → 104k) aunque subió por ronda; lo dice en unidad de valor | Reporta por entregable, no solo por ronda |
