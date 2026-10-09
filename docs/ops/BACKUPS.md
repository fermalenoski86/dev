# BACKUPS — documento operativo (M3A.1 Fase E1 · master §33)

Interfaces y requisitos, **sin atarse a un proveedor**: cada requisito se puede
cumplir con PostgreSQL autogestionado, con un servicio administrado o con
cualquier object storage S3-compatible. Las cifras marcadas *(propuesta)* son
valores por defecto razonables, pendientes de que Fer las confirme según el
contrato operativo con Affinitas; no son una decisión de producto tomada.

## 1. Qué hay que proteger

| Dato | Dónde | Criticidad | Por qué |
|---|---|---|---|
| Esquema y datos de negocio (usuarios, contratos, campañas, drafts) | PostgreSQL | alta | estado operativo |
| `show_versions`, `approvals`, `approval_evidence`, `audit_events` | PostgreSQL | **máxima** | prueba de qué se aprobó, quién y con qué evidencia; cadena de hash |
| Blobs de Assets y de evidencia (`sha256/<2>/<64>`) | object storage | **máxima** para los que referencia una versión | lo que se proyecta y lo que prueba la aprobación |
| Temporales de upload (`tmp/`) | object storage | ninguna | se borran solos por TTL (`TEMP_OBJECT_TTL_MS`) |
| Secretos (`.env` de producción) | gestor de secretos del entorno | alta | **nunca** en este repo ni en los backups de la base |

## 2. PostgreSQL

### Requisitos

1. **Backup completo diario** (físico o lógico) fuera del host de la base.
2. **PITR**: archivado continuo de WAL (o el equivalente del servicio
   administrado) para restaurar a cualquier instante de la ventana.
3. **Retención** *(propuesta)*: ventana PITR de 14 días; diarios 35 días;
   un mensual 12 meses. Los backups de la base contienen `audit_events`:
   la retención mínima es la del requisito de auditoría del contrato.
4. **Objetivos** *(propuesta)*: RPO ≤ 5 minutos (PITR); RTO ≤ 2 horas.
5. Backups **cifrados en reposo** y con acceso separado del acceso de runtime
   (`trust_app` no puede leerlos ni borrarlos).
6. **Restore probado**: el procedimiento de §4 corre en CI en cada PR
   (`apps/platform-api/src/restore-drill.db.test.ts`). La documentación de
   PostgreSQL 16 recomienda probar los restores periódicamente
   (https://www.postgresql.org/docs/16/backup.html). Un ensayo programado
   contra un backup **real** de producción es BL-24 (backlog).
7. Antes de cada `pnpm db:migrate` en producción: backup verificado. Las
   migraciones son forward-only en producción (ver `ERD.md`).

### Cómo cumplirlos (opciones, sin preferencia de proveedor)

- **Autogestionado**: `pg_basebackup` diario + `archive_command` /
  `archive_library` hacia almacenamiento externo (o una herramienta como
  pgBackRest o WAL-G); restore PITR con `recovery_target_time`.
- **Administrado**: activar backups automáticos con PITR y fijar la
  retención; exportar además un `pg_dump -Fc` diario a un bucket propio para
  no depender de un único proveedor.

## 3. Object storage

### Requisitos

1. **Versioning activado** en el bucket de producción: una sobrescritura o un
   borrado accidental deja la versión anterior recuperable.
2. **Protección contra borrado** de los blobs finales: retención por objeto
   (S3 Object Lock en modo *governance* o *compliance*, o el equivalente del
   proveedor) sobre el prefijo `sha256/`. En MinIO, Object Lock exige versioning
   y despliegue con erasure coding (no el modo de un solo disco del compose de
   desarrollo).
3. **Lifecycle**: `tmp/` expira solo (además del barrido de
   `cleanupTemporaryObjects`); las versiones no actuales de `sha256/` se
   conservan al menos lo mismo que los backups de la base.
4. **Réplica** a una segunda ubicación (otra región u otro proveedor)
   *(propuesta)*, con las mismas reglas de retención.
5. Credenciales de runtime **sin permiso de borrado** sobre `sha256/`: el
   código no lo necesita (ver abajo).

### Los blobs de versiones aprobadas no se pueden borrar desde la aplicación

Garantía que ya da el código y que los tests cubren:

- `ObjectStorage` (B1) no tiene **ninguna** operación de borrado de blobs
  finales: solo `deleteTemporary` y `cleanupTemporaryObjects`, que nunca tocan
  `sha256/` (`packages/platform-storage/src/types.ts`).
- No existe ninguna ruta `DELETE` en la API (lista generada del registro de
  Fastify en [`../platform/DELIVERY.md`](../platform/DELIVERY.md)).
- En la base, `stored_objects`, `show_versions`, `show_version_assets`,
  `approvals`, `approval_evidence` y `audit_events` tienen trigger
  `IMMUTABLE_ROW` contra UPDATE/DELETE, también para el dueño del esquema
  (el restore drill lo verifica sobre la base restaurada).

Lo que el código **no** puede garantizar (y por eso son requisitos de
infraestructura, §3.1–3.5): un borrado hecho por fuera de la aplicación con
credenciales de administrador del bucket.

## 4. Restore de PostgreSQL — procedimiento probado

Mismos comandos que ejecuta `restore-drill.db.test.ts` (con `execFile`, sin
shell). Variables: `PGHOST`, `PGPORT`, `PGUSER` (superusuario o el dueño de
los backups) y `PGPASSWORD` desde el gestor de secretos.

```bash
# 1. backup lógico (formato custom, comprimido)
pg_dump -Fc -f trust-AAAAMMDD.dump trust

# 2. base nueva vacía, con el mismo dueño (los roles trust_owner/trust_app
#    existen en el cluster de destino: bootstrap.sql)
psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE trust_restore OWNER trust_owner" postgres

# 3. restore atómico: o entra todo o nada
pg_restore --exit-on-error --single-transaction -d trust_restore trust-AAAAMMDD.dump

# 4. verificación (obligatoria antes de apuntar platform-api a la base restaurada)
#    - conteo de filas por tabla = el del origen (o el esperado al instante PITR)
#    - verifyChain(db) = ok, misma longitud de cadena
#    - pnpm db:migrate no aplica nada (esquema al día)
#    - trust_app puede leer; UPDATE sobre audit_events falla; DELETE sobre stored_objects → IMMUTABLE_ROW
# 5. cambiar DATABASE_URL de platform-api a la base restaurada y comprobar /ready
```

Salida real del drill (PostgreSQL 16.15 local, 2026-10-08; la de CI queda en
el job `postgres` de cada PR):

```
GATE restore-drill: dump 80070 bytes en 114 ms · restore en 136 ms · 18 tablas · 3 audit events · verifyChain ok
```

Los tiempos son de una base de prueba chica: sirven para probar que el
procedimiento funciona, **no** para estimar el RTO de producción. El RTO real
se mide con el ensayo de BL-24 sobre un backup de tamaño real.

### Después de restaurar la base: blobs

Los blobs finales son content-addressed y nunca se borran desde la
aplicación, así que el bucket es un superconjunto de lo que referencia una
base restaurada a un instante anterior. Si también hubo que restaurar el
bucket, cada `stored_objects.storage_key` tiene que existir en él con su
SHA-256 (verificación pendiente de automatizar: propuesta en el reporte de E1).

## 5. Responsables y revisión

- Quien opera la plataforma ejecuta el ensayo de restore real al menos una vez
  por trimestre *(propuesta)* y deja la salida en el registro de operaciones.
- Este documento se revisa con cada migración nueva o cambio de storage.
