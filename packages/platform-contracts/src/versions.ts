/**
 * Constantes de versión — revisión de arquitectura M3A.1, punto 7.
 *
 * Explícitas, no leídas de package.json en runtime. Un test las ata a su
 * fuente (versions.test.ts): si alguien sube la versión de show-authoring o
 * del esquema del ShowPackage sin actualizar acá, la suite falla.
 */

/** Versión de @trust/show-authoring (el compiler). Metadata de la ShowVersion; NO entra en el hash. */
export const SHOW_AUTHORING_VERSION = '0.1.0' as const;

/** Versión del esquema ShowPackage (`version: z.literal(1)` en shared-types). */
export const SHOW_PACKAGE_SCHEMA_VERSION = 1 as const;

/** Versión del sobre que se hashea. Cambiarlo es un cambio de formato deliberado. */
export const HASH_ENVELOPE_VERSION = 1 as const;

export { CANONICALIZATION_VERSION, HASH_ALGORITHM } from './canonical';
