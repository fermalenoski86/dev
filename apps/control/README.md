# TRUST CONTROL

Centro de control operativo. **Milestone 2A: simulación, sin hardware.**

```bash
pnpm --filter @trust/control dev    # http://localhost:3001
```

## Pestañas

| | Qué muestra |
|---|---|
| **OVERVIEW** | Estado de los 9 subsistemas, show actual con transporte, modos del edificio, resumen eléctrico |
| **ENERGY** | General, tres fases, desequilibrio, tendencias (1H–30D), alarmas |
| **EVENTS** | Log unificado con filtro por categoría |
| **AI** | Asistente de solo lectura (mock, sin LLM) |

## Qué es real y qué no

| Real | Simulado |
|---|---|
| El motor de show (`@trust/show-engine`): PLAY, PAUSE, STOP y SAFE MODE tienen exactamente la misma semántica que en PREVIS | Toda la telemetría eléctrica |
| El event log y el filtrado | El estado de EDGE |
| El motor de alarmas (con umbrales DEMO) | Los modos del edificio: cambian estado, no comandan hardware |

**No hay:** Modbus, DMX, Art-Net, procesadores LED, contactores, cámaras, ni
LLM real. El frontend nunca habla con hardware.

## Modo DEV

El selector de escenario eléctrico (NORMAL, HIGH_LOAD, PHASE_IMBALANCE,
UNDERVOLTAGE, PHASE_LOSS, LOW_POWER_FACTOR) solo aparece con
`NODE_ENV !== 'production'`. Un operador no tiene por qué poder cambiar lo que
"mide" el sistema.

## Documentos

- `docs/architecture/ENERGY.md` — alcance y pendientes del módulo eléctrico
- `docs/architecture/OPERATING_STATES.md` — NORMAL / DEGRADED_OFFLINE / SAFE_MODE
- ADR-016 a ADR-019 en `docs/architecture/DECISIONS.md`
