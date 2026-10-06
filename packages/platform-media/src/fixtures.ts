import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Fixtures reales para tests: los genera scripts/make-fixtures.sh (ffmpeg) y
 * se cachean en tmp por hash del script. Nada binario en el repo.
 */
const SCRIPT = path.resolve(__dirname, '../scripts/make-fixtures.sh');

export function mediaFixtures(): (nombre: string) => string {
  const hash = createHash('sha256').update(readFileSync(SCRIPT)).digest('hex').slice(0, 16);
  const dir = path.join(os.tmpdir(), `trust-media-fixtures-${hash}`);
  if (!existsSync(path.join(dir, 'valid_towers_ab_25.mp4'))) {
    const tmp = `${dir}.tmp-${process.pid}`;
    rmSync(tmp, { recursive: true, force: true });
    execFileSync('bash', [SCRIPT, tmp], { stdio: 'pipe' });
    rmSync(dir, { recursive: true, force: true });
    renameSync(tmp, dir);
  }
  return (nombre) => {
    const p = path.join(dir, nombre);
    if (!existsSync(p)) throw new Error(`fixture inexistente: ${nombre}`);
    return p;
  };
}
