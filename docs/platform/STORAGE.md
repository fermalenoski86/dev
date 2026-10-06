# Almacenamiento — M3A.1 Fase B1 + Integrity Gate B1.1

## Interfaz

`ObjectStorage` (`packages/platform-storage`). Dos zonas:

| Zona | Nombre | Mutable | Quién la nombra |
|---|---|---|---|
| Temporal | `tmp/<tempId>/{data,meta.json}` | sí, con TTL | el servidor (UUID) |
| Final | `sha256/<2hex>/<64hex>` | **nunca** | derivada del sha256 (`contentKeyFor`) |

**Clave canónica, sin extensión.** Mismos bytes ⇒ exactamente UNA clave física.
MIME, contenedor, nombre original y extensión son metadata de negocio.
`assertContentKey` exige `sha256/<2hex>/<64hex>` exacto y que el shard sea el
comienzo del hash: sin extensiones, sin paths extra, sin traversal.

## Temporales: reserva atómica

| Estado | Disco | S3 | `statTemporary` | ¿Reutilizable? |
|---|---|---|---|---|
| no existe | sin `tmp/<id>/` | sin `reservation` | `null` | sí |
| reservado / escribiendo | `tmp/<id>/data.part` | `reservation` (+ `data`) | `null` | **no** |
| completo | `data` + `meta.json` | `reservation` + `data` + `meta.json` | info | **no** |
| metadata sin datos, metadata corrupta o tamaño ≠ datos | — | — | `STORAGE_INTEGRITY` | **no** |

- La reserva es exclusiva **antes** de escribir: `mkdir` (disco) o `PutObject If-None-Match: *` (S3).
- `meta.json` se escribe **al final**: es la marca de completitud.
- La metadata se valida (tempId esperado, formato de sha256, tamaño entero ≥ 0, fecha válida) y se contrasta con el tamaño real de los datos.
- Un estado parcial (crash) **nunca se reutiliza en silencio**: el reintento usa un tempId nuevo y el TTL (`cleanupTemporaryObjects`) limpia lo abandonado.

## Integridad del blob final

- Antes de promover se **re-hashea** el temporal.
- Si el blob final **ya existe**, se lee y se calcula su **SHA-256 real** contra
  el sha de la clave. El tamaño solo no prueba nada (caso probado: mismo tamaño,
  otros bytes). Si no coincide: `STORAGE_INTEGRITY`, el final no se toca y el
  temporal válido **no se borra**.
- Si coincide: deduplicación (`created=false`).

## LocalDiskStorage

- `LOCAL_STORAGE_ROOT` absoluto. `root`, `tmp`, `sha256` y los shards quedan en
  **0700 aunque existieran antes** con 0777/0755 (`chmod` + verificación; si no
  se puede, falla el arranque). Datos temporales 0600, finales 0440.
- `lstat` por componente (symlink intermedio), `O_NOFOLLOW` (symlink final),
  creación exclusiva, `fsync` de archivo y directorio.
- Promoción con `link()`: atómica, nunca sobrescribe.

## S3CompatibleStorage

Protocolo S3 (MinIO, AWS S3, compatibles); el SDK queda dentro del adaptador.

**Garantiza:**
- reserva única por tempId (`If-None-Match: *`); estados parciales no se reutilizan;
- un final existente solo se acepta si su SHA-256 real (leído y hasheado) coincide con la clave;
- un final nuevo se copia con `ChecksumAlgorithm: SHA256` y se verifica el checksum del
  servidor contra la clave; si el proveedor no lo devuelve, se re-hashea el objeto.

**No garantiza por sí solo:** que alguien con credenciales del bucket no altere un
objeto después. Eso se cubre con bucket **versionado + object lock** y con la
verificación al deduplicar.

**Diferencia con el disco:** S3 no tiene `link()` atómico. Dos promociones
simultáneas del mismo contenido pueden copiar dos veces: los bytes son
idénticos (la clave es el hash) y ambas copias se verifican.

**Estado:** implementado, compilado, con el **mismo contrato** y los mismos casos
adversariales que el disco. Corre con `S3_TEST_ENDPOINT` (CI + MinIO).
**No se ejecutó en este entorno (sin Docker ni MinIO). No está aprobado hasta
ejecutarse en CI.**

## Frontera DB / storage (B3)

Sin transacción distribuida. Estrategia compensatoria:
1. blob en temporal hasta validar;
2. commit content-addressed idempotente y verificado;
3. StoredObject + Asset READY en una transacción de base;
4. si la base falla después del commit de storage, el blob final queda como
   huérfano **seguro** (puede estar en uso por otro Asset: nunca se borra por
   el fallo de una operación); el reintento idempotente lo reutiliza.
