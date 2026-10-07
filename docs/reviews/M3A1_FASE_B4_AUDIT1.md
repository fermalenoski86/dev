# M3A.1 Fase B4 — respuesta a la auditoría #1

Auditoría: https://github.com/fermalenoski86/dev/pull/5#issuecomment-6035627635
(`AUDIT: CAMBIOS` sobre `2de5883`).

## 1. [P1] Partes multipart posteriores al archivo no se validaban — **Corregido**

Reproducido tal como lo describe el auditor: `surfaceType` + `file` + `admin=true`
devolvía 201, porque el handler respondía apenas `service.upload()` terminaba
y nunca leía las partes que venían después de `file`.

Corrección:
- `AssetUploadService.upload()` acepta un hook `afterBody`, que corre **después**
  de que el archivo llegó entero al temporal y **antes** de crear el Asset o
  reservar la Idempotency-Key. Si lanza, no queda nada: ni Asset ni key ni
  temporal (el `finally` borra el temporal).
- El handler recorre el multipart con un iterador explícito y usa `afterBody`
  para leer el resto. Cualquier parte posterior a `file` (un campo, otro
  archivo, un `surfaceType` repetido) da 400 `VALIDATION_ERROR` con
  `details.unexpectedPart`.
- Sigue siendo streaming: el archivo no se arma en memoria. Las partes
  posteriores son a lo sumo 4 campos de ≤ 1 KB, o un archivo que se descarta
  con `resume()`.
- `limits.files` pasa de 1 a 2. Así el segundo archivo llega al handler y se
  rechaza con el contrato de error, en lugar de cortar por el límite genérico
  del parser.

Evidencia:
- `api.db.test.ts` tiene un test nuevo con 4 casos: campo después de `file`,
  segundo `file`, archivo en otro campo y `surfaceType` repetido después de
  `file`. Los 4 dan 400, sin Asset nuevo, sin fila en `idempotency_keys` y
  con `tmp/` vacío. Además, la misma solicitud bien formada da 201.
- Dos mutaciones nuevas, las dos atrapadas: "api: partes después del archivo
  aceptadas" (quitar el hook) y "assets: afterBody ignorado" (no llamarlo en el
  servicio).
- `docs/platform/API.md` dice explícitamente que **`file` es la última parte**.

## Gates

Salida real: `M3A1_FASE_B4_AUDIT1_SALIDA.txt`. El E2E M2C sigue sin correr en
verde en este entorno (no hay Chrome con H.264); la evidencia es el job
`e2e-m2c` del CI sobre el HEAD nuevo, cuyo enlace va en el PR.
