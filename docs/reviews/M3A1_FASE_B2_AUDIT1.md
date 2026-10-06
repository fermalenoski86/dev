# M3A.1 B2 — respuesta a la auditoría #1 (issue #1)

Rama `fix/m3a1-b2-audit1`. Salida real: `M3A1_FASE_B2_AUDIT1_SALIDA.txt`
(Node 22.22.0, ffmpeg 6.1.1, PostgreSQL 16.15).

## Hallazgo 1 [P1] — mutation-check devolvía exit 0 con mutantes vivos — CORREGIDO
- `clasificar(line)`: **ATRAPADA** solo si vitest informa `N failed`;
  **SOBREVIVE** si solo hay `passed`; **SIN SALIDA** si no aparece la línea
  `Tests` (suite que no arrancó, crash, comando inexistente). Las dos últimas
  tumban el gate con **exit 1**. Una tanda vacía también falla.
- `MUTATION_TEST_CMD` permite demostrarlo sin correr la suite (es tu
  reproducción, sin editar el script). Resultado real:
  `Tests 1 passed` → SOBREVIVE, exit 1 · sin salida → SIN SALIDA, exit 1 ·
  `Tests 1 failed` → ATRAPADA, exit 0. El archivo mutado se restaura en los tres.
- `--autoprueba`: chequea el clasificador.

## Hallazgo 2 [P2] — falso ASSET_CORRUPT en un MP4 sano de un frame — CORREGIDO
- Reproducido: `one_frame_25`, `-ss 0.020` → exit 0 y 0 bytes; `-ss 0` → 4901 bytes.
- Política nueva en `FfmpegFrameDecoder`: si el primer intento termina con
  **exit 0 y sin frame**, se reintenta **una vez desde 0**. El reintento usa
  **lo que resta del mismo timeout** y corre **en el mismo slot** del limitador,
  así que siguen valiendo el timeout, la cancelación y la concurrencia. Si el
  decoder **falla** (exit ≠ 0) no se reintenta: corrupción real.
- Regresión real: fixtures `one_frame_25` / `one_frame_30` (1920×412, a la
  matriz → OK), test del decoder con 40/33 ms, y `corrupt_frames` sigue en
  ASSET_CORRUPT con el reintento disponible.
- Política del reintento: un stub de ffmpeg **solo para contar invocaciones**
  (exit 69 → 1 llamada; exit 0 sin bytes → 2). El camino feliz y la corrupción
  real siguen con binarios reales.
- Mutaciones nuevas: "reintento de decode omitido" y "reintento rescata
  corruptos". Las dos atrapadas.

## Gates pendientes de tu entorno — ejecutados acá
| Gate | Resultado |
|---|---|
| Media real | **53/53** (antes 48: +2 filas de matriz, +3 tests) |
| Mutaciones completas | **109/109 atrapadas**, exit 0 (2 tandas: 55 + 54) |
| `pnpm verify` | 596 passed + 1 skipped · lint 0 errores (11 warnings preexistentes) |
| `pnpm build` | exit 0 |
| PostgreSQL 16 real | 48 passed + 6 skipped (los 6 = bootstrap) |
| Bootstrap real (psql) | 6/6 |
| M2C E2E (Chromium) | **14/14** |

## Para tu entorno
- `scripts/dev/pg-up.sh`: si falta PostgreSQL 16 o el usuario `postgres`, sale
  con exit 2 y te dice qué instalar (`apt-get install -y postgresql-16`).
- `AGENTS.md`: preparación probada del entorno y Chromium vía `TRUST_CHROMIUM_PATH`
  cuando `playwright install` no descarga.

Sin cambios en storage B1, en M2C, ni en las decisiones que ya aprobaste.
