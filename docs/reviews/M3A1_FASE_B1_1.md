# M3A.1 — Integrity Gate B1.1 · resultados reales

Fecha: 2026-10-06T20:00Z · node v22.22.2

## P0 reproducido ANTES de corregir

```
clave   = sha256("AAAA")   contenido existente = "BBBB" (4 bytes, mismo tamaño)
RESULTADO: {"key":"sha256/63/63c1dd95…201.mp4","created":false,"sizeBytes":4} | contenido final: BBBB
```

Ahora: STORAGE_INTEGRITY, el final no se toca y el temporal válido se conserva (test del contrato).

| # | Corrección | Tests |
|---|---|---|
| 1 | Final existente verificado por SHA-256 real (disco y S3) | mismo tamaño/otros bytes · otro tamaño · bytes correctos |
| 2 | Clave canónica sha256/<2>/<64> sin extensión | mismos bytes de dos orígenes ⇒ una clave |
| 3 | assertContentKey: shard = comienzo del hash, sin extensión ni path extra | shard ajeno · .exe/.html/.js/.sh/.mp4 · traversal · path extra |
| 4 | Reserva atómica (mkdir / If-None-Match), meta al final | mismo tempId concurrente · data sin meta · meta sin data · .part abandonado · reintento tras crash |
| 5 | Metadata validada | tempId ajeno · sha inválido · tamaño negativo · fecha inválida · tamaño ≠ datos |
| 6 | Permisos endurecidos al arrancar | root/tmp/sha256/shard preexistentes 0777 ⇒ 0700 |
| 7 | Paridad S3 | mismo contrato y mismos ganchos adversariales (pendiente de CI/MinIO) |

## Storage (disco real)

```
 ✓ packages/platform-storage/src/local-disk.test.ts > ObjectStorage contract — LocalDiskStorage (disco real) > putTemporary calcula sha256 y tamaño DURANTE la escritura; read y stat coinciden
 ✓ packages/platform-storage/src/local-disk.test.ts > ObjectStorage contract — LocalDiskStorage (disco real) > límite superado: StorageLimitError y la reserva se libera
 ✓ packages/platform-storage/src/local-disk.test.ts > ObjectStorage contract — LocalDiskStorage (disco real) > CRITERIO: dos uploads simultáneos con el MISMO tempId: uno gana, el otro STORAGE_CONFLICT
 ✓ packages/platform-storage/src/local-disk.test.ts > ObjectStorage contract — LocalDiskStorage (disco real) > un tempId ya usado no se reutiliza (ni completo)
 ✓ packages/platform-storage/src/local-disk.test.ts > ObjectStorage contract — LocalDiskStorage (disco real) > CRITERIO: estados parciales tras un crash no se pisan ni se toman por válidos
 ✓ packages/platform-storage/src/local-disk.test.ts > ObjectStorage contract — LocalDiskStorage (disco real) > reintento tras un crash: con un tempId NUEVO funciona; el TTL limpia lo abandonado
 ✓ packages/platform-storage/src/local-disk.test.ts > ObjectStorage contract — LocalDiskStorage (disco real) > ids y claves que no generó el servidor se rechazan
 ✓ packages/platform-storage/src/local-disk.test.ts > ObjectStorage contract — LocalDiskStorage (disco real) > CRITERIO: clave canónica sin extensión: mismos bytes ⇒ UNA clave, venga de donde venga
 ✓ packages/platform-storage/src/local-disk.test.ts > ObjectStorage contract — LocalDiskStorage (disco real) > CRITERIO P0: blob final existente con el MISMO tamaño y otros bytes ⇒ STORAGE_INTEGRITY; el temporal válido queda
 ✓ packages/platform-storage/src/local-disk.test.ts > ObjectStorage contract — LocalDiskStorage (disco real) > blob final existente con OTRO tamaño ⇒ STORAGE_INTEGRITY
 ✓ packages/platform-storage/src/local-disk.test.ts > ObjectStorage contract — LocalDiskStorage (disco real) > blob final existente con los bytes CORRECTOS ⇒ dedup (created=false) y se libera el temporal
 ✓ packages/platform-storage/src/local-disk.test.ts > ObjectStorage contract — LocalDiskStorage (disco real) > putIfAbsent: nunca sobrescribe y rechaza contenido que no corresponde a la clave
 ✓ packages/platform-storage/src/local-disk.test.ts > ObjectStorage contract — LocalDiskStorage (disco real) > concurrencia: seis commits simultáneos del mismo contenido terminan en UN blob
 ✓ packages/platform-storage/src/local-disk.test.ts > ObjectStorage contract — LocalDiskStorage (disco real) > commit con un sha256 que no es el del temporal se rechaza
 ✓ packages/platform-storage/src/local-disk.test.ts > ObjectStorage contract — LocalDiskStorage (disco real) > la limpieza borra temporales y NUNCA blobs finales
 ✓ packages/platform-storage/src/local-disk.test.ts > LocalDiskStorage — defensas propias del disco > CRITERIO: arrancar sobre directorios preexistentes 0777 los endurece a 0700
 ✓ packages/platform-storage/src/local-disk.test.ts > LocalDiskStorage — defensas propias del disco > permisos: temporal 0600, final 0440
 ✓ packages/platform-storage/src/local-disk.test.ts > LocalDiskStorage — defensas propias del disco > metadata validada: tempId ajeno, sha inválido, tamaño negativo o fecha inválida ⇒ STORAGE_INTEGRITY
 ✓ packages/platform-storage/src/local-disk.test.ts > LocalDiskStorage — defensas propias del disco > symlink intermedio: un shard sha256/ab que apunta afuera se rechaza
 ✓ packages/platform-storage/src/local-disk.test.ts > LocalDiskStorage — defensas propias del disco > symlink como reserva o como datos: rechazado
 ✓ packages/platform-storage/src/local-disk.test.ts > LocalDiskStorage — defensas propias del disco > un temporal alterado después de escrito no se promueve
 ✓ packages/platform-storage/src/local-disk.test.ts > LocalDiskStorage — defensas propias del disco > el nombre original nunca define el path: solo existen tmp/ y sha256/ con claves canónicas
 ✓ packages/platform-storage/src/local-disk.test.ts > LocalDiskStorage — defensas propias del disco > TTL: la limpieza borra solo reservas más viejas que el TTL
 ✓ packages/platform-storage/src/local-disk.test.ts > LocalDiskStorage — defensas propias del disco > streaming: 96 MB pasan sin cargarse en memoria
      Tests  24 passed | 1 skipped (25)
```

## Mutaciones nuevas (scripts/mutation-check.py, reglas 94–97)

```
ATRAPADA   storage: dedup solo por tamaño 
ATRAPADA   storage: shard≠hash aceptado 
ATRAPADA   storage: temporal huérfano pisado 
ATRAPADA   storage: permisos no endurecidos 
TODAS ATRAPADAS
sin mutaciones pendientes
```

## pnpm verify

```
✖ 11 problems (0 errors, 11 warnings)
      Tests  572 passed | 1 skipped (573)
```

## Plataforma contra PostgreSQL real (sin regresión)

```
      Tests  48 passed | 6 skipped (54)
```

## S3

Implementado y compilado; mismo contrato y mismos casos adversariales. NO ejecutado en este
entorno (sin Docker ni MinIO). No se declara aprobado hasta correr en CI.

## Nota

stored_objects.storage_key (migración 0001) todavía ADMITE una extensión opcional. La unicidad
por sha256 ya impide duplicados, y el storage solo genera claves canónicas; si se quiere que
la base también rechace la extensión, va en la migración 0002 de B3.
