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

## Ronda 1 — respuesta a `AUDIT: CAMBIOS` (2026-10-11)

[Comentario del auditor](https://github.com/fermalenoski86/dev/pull/50#issuecomment-6107845111) sobre `e4983a4`.

| Hallazgo | Respuesta |
|---|---|
| 1 [P1] Q0/Q2 sin decisión de producto | **No se puede cerrar desde acá:** la decisión es de Fer en #52 (abierta, sin respuesta). El brief queda marcado como **bloqueado por Q0/Q2** (encabezado y §7); no se implementa ni se pide aprobar la versión final hasta registrar su respuesta. |
| 2 [P1] Sin backfill de `active_version_id` | Agregado §1.5: backfill `active_version_id = latest_approved_version_id` en la misma migración; campaña sin aprobaciones = `null` (sin vigente); down/up con datos poblados; criterio §6.12. Vale para A2.1 y A2.2. |
| 3 [P1] Reintentos y 409 con efecto | Agregados §3.6 (Idempotency-Key en pedir, confirmar y cancelar, con operación, fingerprint y replay definidos sobre `withIdempotency`) y §3.7 (los 409 que terminalizan un pedido **devuelven** `{status: 409}` desde la función de `withIdempotency` → COMMIT del estado, del audit y de la respuesta guardada; los 409 sin efecto siguen con `throw`). Criterios §6.8 (confirmación aplicada con respuesta perdida) y §6.13 (estado y audit persistidos después del 409, con mutación `return`→`throw`). |
| Q1/Q3/Q4/Q5/Q6 | Incorporadas como **acordadas** (§1.4, §3.1, §3.2, §3.4, §5, §7). Q1 con el endurecimiento pedido (`search_path` con `pg_temp` al final, `REVOKE … FROM PUBLIC`, grant a `trust_app`) y criterio §6.14. Q5 con reloj de la base. |

Mecanismo de §3.7 verificado contra el código: `withIdempotency` guarda
`{status, body}` de lo que devuelve la función y hace COMMIT; en el replay
devuelve el status guardado (`packages/platform-db/src/idempotency.ts`).

## Ronda 2 — `AUDIT: CAMBIOS` (2026-10-11)

[Comentario](https://github.com/fermalenoski86/dev/pull/50#issuecomment-6108767635): hallazgos 2 y 3 **cerrados** (sin evento de backfill); hallazgo 1 sigue abierto por #52.

| Hallazgo | Respuesta |
|---|---|
| [P2] tabla §7 con cabecera duplicada | Corregido: queda una sola cabecera `# \| Pregunta \| Estado` y su separador. |
