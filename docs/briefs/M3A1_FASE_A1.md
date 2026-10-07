MASTER OF TRUST — M3A.1
FASE A.1 — RELATIONAL INTEGRITY GATE

NO empezar Fase B todavía.
La arquitectura general de Fase A está aprobada.

Corregir únicamente estas invariantes y agregar tests PostgreSQL reales.

1. SHOW VERSION ASSET MANIFEST INMUTABLE

Problema:
show_versions es inmutable pero show_version_assets sigue aceptando INSERT
después de creada/aprobada la versión.

Una ShowVersion debe quedar completamente sellada:
ShowPackage + asset manifest.

Preferencia:
crear una única operación transaccional createShowVersion() que:

- inserta show_versions;
- inserta TODOS sus show_version_assets;
- registra audit;
- termina.

Revoke INSERT directo de trust_app sobre:
show_versions
show_version_assets

y exponer una función/procedimiento o pathway controlado que cree ambos
atómicamente.

Después de commit:
no debe poder agregarse ningún logicalRef.

Alternativa equivalente aceptable si mantiene integridad DB real.

Agregar test:

crear versión con 2 assets
→ commit
→ intentar INSERT de un tercer show_version_asset
→ DB lo rechaza.

Y otro:
aprobar versión
→ intentar agregar asset
→ DB lo rechaza.

2. RELATIONAL OWNERSHIP

Agregar invariantes DB:

A) Campaign.current_draft_id:
el draft referido DEBE pertenecer a esa misma Campaign.

B) Campaign.latest_approved_version_id:
la versión debe pertenecer a esa misma Campaign
Y tener Approval decision=APPROVED.

C) ShowVersion.source_draft_id:
el Draft debe pertenecer al mismo campaign_id de la versión.

D) Al crear ShowVersion:
source_draft_revision debe ser exactamente la revision actual del Draft
en ese instante.

Después el Draft puede seguir evolucionando;
la versión conserva el número snapshot.

Implementar mediante composite FK y/o triggers robustos.

Agregar tests cruzados Campaign A / Campaign B.

3. ASSET TERMINAL IMMUTABILITY

Estados permitidos:

UPLOADING → VALIDATING → READY
UPLOADING/VALIDATING → REJECTED

Una vez READY o REJECTED:
la identidad/contenido técnico del Asset queda congelado.

Bloquear cambios posteriores de:

stored_object_id
mime_type
size_bytes
width
height
fps
codec
duration_ms
surface_type
status/rejection_code según corresponda

READY no puede volver a VALIDATING/UPLOADING.
REJECTED no puede volver a READY.

Agregar stored_object_id también en show_version_assets
o garantizar de otra forma equivalente que Deploy pueda resolver
directamente el blob físico inmutable aprobado, sin depender de un Asset
mutable.

Agregar tests.

4. VERSION HASH NO UNIQUE GLOBAL

Quitar UNIQUE de show_versions.version_hash.

Crear índice normal:

CREATE INDEX ... ON show_versions(version_hash)

Debe ser válido:

Campaign A / Version 1 → hash X
Campaign B / Version 1 → hash X

porque el contenido es idéntico pero las versiones comerciales son distintas.

Agregar test.

5. IDEMPOTENCY FINGERPRINT CANÓNICO

Cambiar:

JSON.stringify(payload)

por fingerprint determinista:

SHA256(
  canonicalize({
    operation,
    payload
  })
)

Mismo objeto con keys en distinto orden:
mismo fingerprint.

Agregar test.

6. IDEMPOTENCY EXPIRATION

Hoy expires_at existe pero una key expirada sigue bloqueando por PK.

Definir comportamiento:

si expires_at <= now():
la key puede reutilizarse de forma segura.

Implementar cleanup/reclaim transaccional.

Agregar tests:
- vigente → replay
- vigente + distinto fingerprint → 409
- expirada → nueva operación permitida
- concurrencia al reutilizar una expirada → solo una ejecución.

7. BOOTSTRAP REAL

Los tests actuales NO ejecutan bootstrap.sql;
testing.ts crea roles por otro camino.

Agregar test/script real que ejecute con psql:

bootstrap.sql
→ crear roles
→ crear DB/schema de prueba
→ migrations up como trust_owner
→ conexión trust_app
→ confirmar:
   no DDL
   no UPDATE/DELETE de inmutables
   migrations funcionan.

No declarar bootstrap validado si se testeó mediante un camino JS distinto.

Revisar especialmente la sustitución de owner_password/app_password dentro
del DO block.

8. TESTS DE REGRESIÓN

Mantener:
545 tests existentes
30 DB
21 platform-contracts

Agregar los anteriores.

Ejecutar PostgreSQL real.

No empezar storage/API de Fase B hasta entregar:

- patch
- migración actualizada
- resultados reales
- tests nuevos
- ERD actualizado si cambia algo.

FASE A queda aprobada solamente después de este integrity gate.