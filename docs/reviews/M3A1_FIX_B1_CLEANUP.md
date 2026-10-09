# Fix B1: limpieza de temporales con TTL 0 y mtime fraccionario

**Origen:** CI del PR #10 (run 37705216402, job `verify-build`). Falló el test
de contrato "la limpieza borra temporales y NUNCA blobs finales"
(`cleanupTemporaryObjects(0)` devolvió 0). C3 no toca `platform-storage`.

**Causa (bug demostrado):** `LocalDiskStorage.cleanupTemporaryObjects` compara
`st.mtimeMs`, que trae fracción de milisegundo, con `Date.now() - olderThanMs`,
que es entero. Si un temporal se escribe en el mismo milisegundo del corte, su
mtime queda 0,x ms "por delante" (por ejemplo 1000,4 > 1000) y no se borra. Con
TTL real (24 h) solo corre el corte unos microsegundos. En el test de contrato,
con TTL 0, la limpieza falla según el azar del reloj.

**Corrección mínima:** se compara `Math.floor(mtimeMs)` con el límite, con
resolución de ms en las dos marcas. No cambia la arquitectura de B1: los blobs
finales siguen intocables.

**Regresión determinística:** `local-disk.test.ts`, "limpieza con TTL 0: un
temporal del mismo milisegundo (mtime con fracción) se borra". Fija
`Date.now()` en T y el mtime del temporal en T + 0,4 ms con `utimes`.
- sin el fix: **falla** (1 failed | 24 passed), reproducido en este entorno;
- con el fix: 25 passed.

Mutación nueva: "storage: limpieza compara con fracción de ms" → **atrapada**.
`pnpm verify`: 638 passed + 1 skipped, lint 0 errores.
