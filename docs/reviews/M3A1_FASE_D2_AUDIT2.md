# M3A.1 Fase D2 — respuesta a AUDIT 2 (re-auditoría 2, CAMBIOS)

HEAD revisado: `54bbe928ec493b5c6cdabae838abc372e25bc967` (código `8dc228f`).
Salida real de los gates: `M3A1_FASE_D2_AUDIT2_SALIDA.txt`.

## P1 — Falla parcial entre la clave M2C y la de sync perdía trabajo al reabrir

**Corregido.** Primero se reprodujo el problema: con el `syncing.ts` auditado,
las 4 regresiones nuevas fallan; con la corrección pasan (24/24 unitarios).

La causa era el orden: se escribía primero el espejo M2C y después el registro
de sync. Si fallaba el segundo, el draft nuevo quedaba solo en M2C, y un `open`
posterior, que lee únicamente el registro, adoptaba el servidor y pisaba M2C.

### Protocolo nuevo (`escribir` en `syncing.ts`)

1. **Primero el registro de sync**: es la fuente de verdad y contiene el draft.
2. **Después el espejo M2C** (`saveDraft`, formato sin cambios).
3. Si el espejo falla, se **restaura el registro anterior** (o se borra, si no
   había uno) y se lanza `LOCAL_STORAGE_UNAVAILABLE`.

**Invariante:** todo draft que el repositorio dejó en la clave M2C está
también en su registro. Casos de falla:

| Falla | Estado en disco | Al reabrir |
|---|---|---|
| el registro | nada cambió | igual que antes; no se perdió nada que hubiera llegado a disco |
| el espejo | las dos claves en el estado anterior | igual que antes |
| el espejo y la restauración | registro con el draft nuevo `pending`; M2C viejo | `open` conserva el draft nuevo y lo sube |

**Defensa adicional:** al adoptar el servidor (`open`, `recoverServer`), la
clave M2C se pisa solo si tiene lo que el repositorio escribió la última vez
(o está vacía). Si otro escritor la cambió (el Builder actual escribe ahí
directo mientras D3 siga bloqueado), se conserva en vez de perderse en
silencio. Las ediciones propias del repositorio siempre actualizan el espejo.

Sigue valiendo lo de la ronda anterior: toda falla de storage corta antes del
PUT y antes de tocar el estado en memoria. Las 3 regresiones de AUDIT 1 siguen
verdes, incluida la que exige que la metadata quede intacta byte a byte.

### Regresiones nuevas

Usan un storage con fallas por clave (`conFallas`) y un repositorio nuevo para
simular el reinicio del Builder:

1. Falla **solo** la clave de sync → `LOCAL_STORAGE_UNAVAILABLE` sin PUT; M2C y
   el registro sin cambios. Al reiniciar, el repositorio ve exactamente lo que
   hay en disco.
2. Fallan el espejo M2C **y** la restauración → el registro queda con el draft
   nuevo `pending`. Al reiniciar con el storage sano, `open` lo recupera, lo
   sube (revisión 2) y actualiza el espejo.
3. Lo mismo para la primera escritura de una campaña: no hay registro previo y
   el `removeItem` falla. También es recuperable al reabrir.
4. M2C escrita por otro escritor → `open` adopta el servidor sin pisarla; la
   próxima edición propia sí la actualiza.

### Mutaciones nuevas (4) y una ajustada

- `d2: espejo M2C antes del registro`
- `d2: sin restaurar el registro`
- `d2: adoptar servidor pisa M2C ajeno`
- `d2: espejo ajeno tomado como propio`
- Se ajustó el patrón de `d2: draft local fallido se sube igual` al código nuevo.

Total: 215 reglas.

## No ejecutado localmente

E2E M2C (no hay Chrome con H.264 en este entorno): lo cubre el job `e2e-m2c` de CI.
