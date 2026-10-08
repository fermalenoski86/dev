import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Fixtures reales para tests: los genera scripts/make-fixtures.sh (ffmpeg) y
 * se cachean en tmp por hash del script. Nada binario en el repo.
 */
// import.meta.url y no __dirname: el paquete es ESM (lo importa también el smoke con tsx).
const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/make-fixtures.sh');

/** Archivo que existe solo si el directorio publicado está completo. */
const MARCA = 'valid_towers_ab_25.mp4';

export interface FixtureOptions {
  /** Directorio final del caché (default: tmp por hash del script). Para tests. */
  dir?: string;
  /** Generador (default: scripts/make-fixtures.sh con ffmpeg). Para tests. */
  generate?: (tmp: string) => void;
}

export function mediaFixtures(opts: FixtureOptions = {}): (nombre: string) => string {
  const hash = createHash('sha256').update(readFileSync(SCRIPT)).digest('hex').slice(0, 16);
  const dir = opts.dir ?? path.join(os.tmpdir(), `trust-media-fixtures-${hash}`);
  const generar = opts.generate ?? ((tmp: string) => execFileSync('bash', [SCRIPT, tmp], { stdio: 'pipe' }));
  if (!existsSync(path.join(dir, MARCA))) {
    // Los archivos *.real.test.ts corren en workers paralelos: con el caché
    // frío, varios generan a la vez. Cada uno en su tmp y después rename
    // atómico; si otro ya publicó el directorio, el rename falla y se descarta
    // el propio. NUNCA se borra `dir`: otro worker puede estar leyéndolo
    // (falla intermitente "fixture inexistente" en CI, PR #23).
    const tmp = `${dir}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
    rmSync(tmp, { recursive: true, force: true });
    generar(tmp);
    try {
      renameSync(tmp, dir);
    } catch (e) {
      rmSync(tmp, { recursive: true, force: true });
      if (!existsSync(path.join(dir, MARCA))) throw e;
    }
  }
  return (nombre) => {
    const p = path.join(dir, nombre);
    if (!existsSync(p)) throw new Error(`fixture inexistente: ${nombre}`);
    return p;
  };
}
