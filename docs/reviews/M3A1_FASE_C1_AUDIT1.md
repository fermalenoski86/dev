# M3A.1 — Fase C1: respuesta a AUDIT: CAMBIOS #1

Auditoría sobre `926b911`: https://github.com/fermalenoski86/dev/pull/7#issuecomment-6041680970

## [P1] rate limit: memoria sin límite — **Corregido**

`LoginRateLimiter` (`packages/platform-auth/src/rate-limit.ts`):

1. **Barrido de vencidas.** La ventana es la misma para todas las claves y una
   clave solo se inserta cuando no existe, así que el orden de inserción del
   `Map` es el orden de vencimiento. Cada `check` barre desde el principio las
   vencidas y corta en la primera vigente: O(1) amortizado por clave creada.
2. **Tope duro con política explícita:** `maxKeys` (100 000 por defecto). Al
   llegar al tope se descarta la clave más vieja, que es la más cercana a vencer.
   `stats().evicted` lleva la cuenta. Por qué descartar y no rechazar: si se
   rechazaran las claves nuevas, un atacante que llenara el mapa bloquearía el
   login de todos. Con el descarte, para resetear el contador de una víctima
   hay que crear 100 000 claves dentro de la ventana, y cada dirección crea
   como mucho 50 claves de email por ventana.
3. **Claves validadas:** una IP inválida cae en un único balde `?:invalid`, ya
   no en `?:<valor>`. El email se recorta a 320 caracteres. La configuración se
   valida (enteros positivos).

Regresiones (`rate-limit.test.ts`):

- La **reproducción exacta del auditor** ahora da 20 000 → 20 000, no 40 000.
  Pasada la segunda ventana queda en 2.
- Una clave que reabre su ventana no corta el barrido.
- El tope nunca se excede y cuenta los descartes.
- Las IPs inválidas comparten un solo balde y los emails gigantes se recortan.

Mutaciones nuevas, todas atrapadas:

- rate limit sin barrido;
- sin tope;
- claves de IP arbitrarias.

Una cuarta mutación ("pierde el orden de vencimiento": no borrar antes de
reinsertar) **sobrevivió**. Al analizarla resultó ser código muerto: el barrido
siempre saca la clave vencida antes de que se reutilice. Se eliminó esa rama
del código en lugar de dejar un mutante equivalente. Total: 153 reglas.

Documentado en `docs/platform/AUTH.md` (sección Login y rate limit). La
limitación por proceso (multiinstancia → BL-10) se mantiene, como aceptó el
auditor.

## Gates

Salida real en `M3A1_FASE_C1_AUDIT1_SALIDA.txt`. Lo que pasó en esta corrida:

- **El cluster de PostgreSQL se cayó** por un reinicio del contenedor. Se
  levantó de nuevo con `pg-up.sh` antes de correr los gates. Unas mutaciones
  probadas sin la base dieron "SIN SALIDA" y no cuentan como evidencia: la
  corrida válida es la completa, posterior.
- La primera corrida de `pnpm verify` falló en
  `show-authoring/src/preview-session.test.ts` ("RESTART sin haber tocado
  nada"). Es el mismo fallo intermitente que vio el auditor y no está en el
  cambio. El archivo aislado pasó 28/28 y la repetición completa de verify
  pasó. No lo toco: es código de M2C.
- El E2E no se corrió localmente (no hay Chrome con H.264); la evidencia es el
  CI exacto.
