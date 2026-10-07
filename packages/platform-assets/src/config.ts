/**
 * MAX_UPLOAD_BYTES — límite de upload (§6). Default de desarrollo: 500 MB, el mismo
 * valor documentado en .env.example. En producción se fija por entorno.
 */
export const DEFAULT_MAX_UPLOAD_BYTES = 524_288_000;

export function maxUploadBytesFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const v = env.MAX_UPLOAD_BYTES;
  if (v === undefined || v === '') return DEFAULT_MAX_UPLOAD_BYTES;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`MAX_UPLOAD_BYTES tiene que ser un entero >= 1 (vino "${v}")`);
  return n;
}
