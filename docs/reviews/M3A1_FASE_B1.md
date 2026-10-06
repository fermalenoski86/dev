# M3A.1 — Fase B1 · checkpoint (almacenamiento)

Fecha: 2026-10-06T19:37Z · node v22.22.2

## Entregado

- packages/platform-storage: ObjectStorage, LocalDiskStorage, S3CompatibleStorage, storageFromEnv.
- Contrato de tests compartido (src/contract.ts) + defensas propias del disco.
- docs/platform/STORAGE.md, .env.example, ADR-052.

## Tests de storage (disco real)

```
 ✓ packages/platform-storage/src/local-disk.test.ts > ObjectStorage contract — LocalDiskStorage (disco real) > putTemporary calcula sha256 y tamaño DURANTE la escritura; read y stat coinciden
 ✓ packages/platform-storage/src/local-disk.test.ts > ObjectStorage contract — LocalDiskStorage (disco real) > límite superado: StorageLimitError y no queda temporal
 ✓ packages/platform-storage/src/local-disk.test.ts > ObjectStorage contract — LocalDiskStorage (disco real) > ids y claves que no generó el servidor se rechazan antes de tocar nada
 ✓ packages/platform-storage/src/local-disk.test.ts > ObjectStorage contract — LocalDiskStorage (disco real) > commit content-addressed: clave derivada del sha256, contenido íntegro, temporal eliminado
 ✓ packages/platform-storage/src/local-disk.test.ts > ObjectStorage contract — LocalDiskStorage (disco real) > dedup: el mismo contenido dos veces = un solo blob, el segundo no reescribe
 ✓ packages/platform-storage/src/local-disk.test.ts > ObjectStorage contract — LocalDiskStorage (disco real) > concurrencia: seis commits simultáneos del mismo contenido terminan en UN blob
 ✓ packages/platform-storage/src/local-disk.test.ts > ObjectStorage contract — LocalDiskStorage (disco real) > nunca sobrescribe un blob final: otro contenido bajo esa clave se rechaza
 ✓ packages/platform-storage/src/local-disk.test.ts > ObjectStorage contract — LocalDiskStorage (disco real) > commit con un sha256 que no es el del temporal se rechaza
 ✓ packages/platform-storage/src/local-disk.test.ts > ObjectStorage contract — LocalDiskStorage (disco real) > la limpieza borra temporales y NUNCA blobs finales
 ✓ packages/platform-storage/src/local-disk.test.ts > LocalDiskStorage — defensas propias del disco > symlink intermedio: un directorio sha256/ab que apunta afuera se rechaza
 ✓ packages/platform-storage/src/local-disk.test.ts > LocalDiskStorage — defensas propias del disco > symlink en el último tramo: un temporal que es un symlink no se lee
 ✓ packages/platform-storage/src/local-disk.test.ts > LocalDiskStorage — defensas propias del disco > un temporal alterado después de escrito no se promueve
 ✓ packages/platform-storage/src/local-disk.test.ts > LocalDiskStorage — defensas propias del disco > permisos restrictivos: dirs 0700, temporal 0600, final 0440
 ✓ packages/platform-storage/src/local-disk.test.ts > LocalDiskStorage — defensas propias del disco > el nombre original nunca define el path: solo existen tmp/ y sha256/
 ✓ packages/platform-storage/src/local-disk.test.ts > LocalDiskStorage — defensas propias del disco > TTL: la limpieza borra solo temporales más viejos que el TTL
 ✓ packages/platform-storage/src/local-disk.test.ts > LocalDiskStorage — defensas propias del disco > streaming: 96 MB pasan sin cargarse en memoria
      Tests  16 passed | 1 skipped (17)
```

## pnpm verify

```
✖ 11 problems (0 errors, 11 warnings)
      Tests  564 passed | 1 skipped (565)
```

## Mutación manual (código restaurado)

- assertContentKey sin validar: falla el test de traversal.

## S3 — no ejecutado en este entorno

Implementado y compilado. Corre el mismo contrato con S3_TEST_ENDPOINT (CI con MinIO).
En este entorno no hay Docker ni MinIO: el test figura como omitido, con el motivo.

## Contradicciones del modelo detectadas (se resuelven en B3 con migración 0002)

1. assets sin rejection_detail (detalle estructurado del rechazo, punto 5).
2. assets sin container (READY debe reflejar el contenedor real, punto 13).
3. La base no verifica size_bytes / mime_type del Asset contra el StoredObject al pasar a READY (punto 14).
4. AuditAction no incluye ASSET_VALIDATION_STARTED (punto 27).

Propuesta: migración 0002 (la 0001 ya fue auditada): columnas rejection_detail jsonb y container text,
trigger de transición que exige coherencia con el objeto físico al pasar a READY, y la acción nueva.
