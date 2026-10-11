# F3(a) — brief documental para acuerdo

**Qué es:** solo documento (`docs/briefs/F3A_REDEPLOY.md`). Sin código, sin
migración, sin cambios de API. Encargado por el `AUDIT: APROBADO` de BL-08
(#48): preparar el brief y acordarlo con ChatGPT antes de implementar.

**Rama:** `fase/f3a-brief` desde `main@911f7b5`. Salida real: `F3A_BRIEF_SALIDA.txt`.

## Autorrevisión previa

### A. Contra el encargo

| Pedido | Dónde |
|---|---|
| Semántica de autorización | brief §3 (roles por paso, scope por contrato, 404/403) y Q3/Q4 |
| Four-eyes | §3 ("quien pide no confirma", app + trigger, por contrato) |
| Auditoría | §4 (acciones nuevas, misma transacción, `verifyChain`) |
| Pruebas | §6 (11 criterios verificables + mutaciones `f3a:`) |
| No inventar producto | §0 (choque con "no deploy" del master) y Q0/Q2 marcadas como decisión de Fer |

### B. Revisión adversaria del brief

- **"Redeploy" sin deploy:** el master prohíbe Deploy en M3A.1; el brief no lo
  esconde: lo pone como Q0 y propone un puntero de control plane, no un push.
- **Romper invariantes vigentes:** se descarta mover `latest_approved_version_id`
  hacia atrás (opción B) porque el servicio de aprobación asume que solo avanza.
- **Partes estables tocadas:** A2.1 toca `platform-approval`; está declarado
  para que se juzgue. Nada en `apps/control`, M2C, storage B1 ni ShowPackage.
- **Carreras:** pedido/confirmación con campaña bloqueada, `expectedActiveVersionId`
  y un solo PENDING por campaña (índice único parcial).
- **Cuatro ojos eludible:** segunda barrera en la base, como `trust_four_eyes`.
- **Enumeración:** versión de otra campaña = 404, igual que BL-31.
- Códigos de error verificados contra el código actual
  (`SHOW_VERSION_NOT_FOUND`, `INVALID_STATE_TRANSITION`, `VERSION_HASH_MISMATCH`);
  los nuevos (`ACTIVE_VERSION_*`) quedan propuestos.

### C. CI

Se cita la corrida exacta del HEAD en el pedido de acuerdo. Al ser solo
documentación, los gates corren igual en CI (sin cambios de código esperados).
