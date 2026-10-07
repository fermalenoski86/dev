/**
 * Benchmark reproducible de Argon2id (decisión 5 del brief C).
 *
 *   pnpm --filter @trust/platform-auth bench:argon2 [-- --runs 20]
 *
 * Mide hash y verify con los parámetros de producción (ARGON2_PARAMS) y con
 * candidatos más caros. Sirve para decidir si se suben los parámetros EN LA
 * INFRAESTRUCTURA REAL: se corre allí y se anota la salida en el PR que los
 * cambie. Nunca se suben sin esta medición.
 */
import os from 'node:os';
import { parseArgs } from 'node:util';
import { type Algorithm, hash, verify } from '@node-rs/argon2';
import { ARGON2_PARAMS } from '../src/password';

const { values } = parseArgs({ args: process.argv.slice(2).filter((a) => a !== '--'), options: { runs: { type: 'string', default: '10' } } });
const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1 || runs > 1000) throw new Error('--runs entre 1 y 1000');

const candidatos: Array<{ nombre: string; memoryCost: number; timeCost: number; parallelism: number }> = [
  { nombre: 'actual (OWASP mínimo)', memoryCost: ARGON2_PARAMS.memoryCost, timeCost: ARGON2_PARAMS.timeCost, parallelism: ARGON2_PARAMS.parallelism },
  { nombre: 'm=46MiB t=1 p=1 (OWASP alt.)', memoryCost: 47_104, timeCost: 1, parallelism: 1 },
  { nombre: 'm=64MiB t=3 p=1', memoryCost: 65_536, timeCost: 3, parallelism: 1 },
];

const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] as number;
console.log(`node ${process.version} · ${os.cpus()[0]?.model ?? '?'} ×${os.cpus().length} · ${Math.round(os.totalmem() / 2 ** 30)} GiB · runs=${runs}`);
for (const c of candidatos) {
  const opts = { algorithm: ARGON2_PARAMS.algorithm as Algorithm, memoryCost: c.memoryCost, timeCost: c.timeCost, parallelism: c.parallelism };
  const pw = 'benchmark password 2026';
  const h0 = await hash(pw, opts); // calentamiento
  const tHash: number[] = [];
  const tVerify: number[] = [];
  for (let i = 0; i < runs; i++) {
    let t = performance.now();
    await hash(pw, opts);
    tHash.push(performance.now() - t);
    t = performance.now();
    if (!(await verify(h0, pw))) throw new Error('verify falló');
    tVerify.push(performance.now() - t);
  }
  console.log(`${c.nombre.padEnd(30)} hash p50=${pct(tHash, 50).toFixed(1)}ms p95=${pct(tHash, 95).toFixed(1)}ms · verify p50=${pct(tVerify, 50).toFixed(1)}ms p95=${pct(tVerify, 95).toFixed(1)}ms · ${h0.split('$')[3]}`);
}
