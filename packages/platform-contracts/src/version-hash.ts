import { CANONICALIZATION_VERSION, HASH_ALGORITHM, canonicalize, sha256Hex } from './canonical';
import { HASH_ENVELOPE_VERSION, SHOW_PACKAGE_SCHEMA_VERSION } from './versions';

/**
 * Hash de ShowVersion — revisión de arquitectura M3A.1, punto 8.
 *
 *   {
 *     hashEnvelopeVersion: 1,
 *     showPackageSchemaVersion: 1,
 *     showPackage,
 *     assets: [{ logicalRef, sha256 }]   ← ordenados por logicalRef
 *   }
 *   → JCS RFC 8785 → UTF-8 → SHA-256
 *
 * compilerVersion NO entra: mismo ShowPackage + mismos bytes de assets = mismo
 * hash, sin importar qué versión compatible del compiler lo produjo. Se guarda
 * aparte, como metadata de la versión.
 *
 * Los assets entran por la RANURA del draft (logicalRef) y por su CONTENIDO
 * (sha256), nunca por UUID ni por nombre de archivo.
 */
export interface VersionAssetRef {
  /** Ranura del draft: 'masterAssetId', 'horizontalAssetId', ... */
  logicalRef: string;
  /** SHA-256 hex del contenido real del archivo. */
  sha256: string;
}

export interface HashEnvelope {
  hashEnvelopeVersion: typeof HASH_ENVELOPE_VERSION;
  showPackageSchemaVersion: typeof SHOW_PACKAGE_SCHEMA_VERSION;
  showPackage: unknown;
  assets: VersionAssetRef[];
}

export interface VersionHashResult {
  versionHash: string;
  hashAlgorithm: typeof HASH_ALGORITHM;
  canonicalizationVersion: typeof CANONICALIZATION_VERSION;
  hashEnvelopeVersion: typeof HASH_ENVELOPE_VERSION;
  showPackageSchemaVersion: typeof SHOW_PACKAGE_SCHEMA_VERSION;
  /** La forma canónica exacta que se hasheó: permite auditar el hash. */
  canonical: string;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function buildHashEnvelope(showPackage: unknown, assets: readonly VersionAssetRef[]): HashEnvelope {
  const vistos = new Set<string>();
  for (const a of assets) {
    if (!a.logicalRef) throw new Error('asset sin logicalRef');
    if (!SHA256_HEX.test(a.sha256)) throw new Error(`sha256 inválido para ${a.logicalRef}`);
    if (vistos.has(a.logicalRef)) throw new Error(`logicalRef duplicado: ${a.logicalRef}`);
    vistos.add(a.logicalRef);
  }
  // logicalRef es único: ordenar por él es determinista sin desempate.
  const ordenados = [...assets]
    .map((a) => ({ logicalRef: a.logicalRef, sha256: a.sha256 }))
    .sort((x, y) => (x.logicalRef < y.logicalRef ? -1 : x.logicalRef > y.logicalRef ? 1 : 0));
  return {
    hashEnvelopeVersion: HASH_ENVELOPE_VERSION,
    showPackageSchemaVersion: SHOW_PACKAGE_SCHEMA_VERSION,
    showPackage,
    assets: ordenados,
  };
}

export function computeVersionHash(showPackage: unknown, assets: readonly VersionAssetRef[]): VersionHashResult {
  const canonical = canonicalize(buildHashEnvelope(showPackage, assets));
  return {
    // sha256Hex codifica el string como UTF-8: JCS → UTF-8 → SHA-256.
    versionHash: sha256Hex(canonical),
    hashAlgorithm: HASH_ALGORITHM,
    canonicalizationVersion: CANONICALIZATION_VERSION,
    hashEnvelopeVersion: HASH_ENVELOPE_VERSION,
    showPackageSchemaVersion: SHOW_PACKAGE_SCHEMA_VERSION,
    canonical,
  };
}
