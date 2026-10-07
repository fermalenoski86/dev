import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { mediaFixtures } from './fixtures';
import { checkMedia } from './pipeline';
import { INPUT_PLACEHOLDER, OUTPUT_PLACEHOLDER, remediationFor } from './remediation';
import { mediaRuntimeFromEnv } from './runtime';
import { LocalPathSource } from './source';

/**
 * BL-03, criterio acordado: aplicar el comando sugerido a cada fixture
 * rechazable y que el resultado PASE checkMedia. ffmpeg real, execFile sin shell.
 */
const run = promisify(execFile);
const rt = mediaRuntimeFromEnv({ MEDIA_INSPECTION_CONCURRENCY: '4' });
let fx: (n: string) => string;
let dir: string;
beforeAll(async () => {
  fx = mediaFixtures();
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-remediation-'));
});

describe('CRITERIO: BL-03 — la receta sugerida produce un archivo que pasa checkMedia', () => {
  const casos: Array<[string, string, string]> = [
    ['bad_resolution.mp4', 'horizontal', 'ASSET_BAD_RESOLUTION'],
    ['bad_codec_hevc.mp4', 'horizontal', 'ASSET_BAD_CODEC'],
    ['bad_fps_2997.mp4', 'horizontal', 'ASSET_BAD_FPS'],
    ['bad_fps_23976.mp4', 'horizontal', 'ASSET_BAD_FPS'],
    ['bad_fps_50.mp4', 'horizontal', 'ASSET_BAD_FPS'],
    ['bad_container_mov.mp4', 'horizontal', 'ASSET_BAD_CONTAINER'],
    ['bad_container_mkv.mp4', 'horizontal', 'ASSET_BAD_CONTAINER'],
    ['bad_container_avi.mp4', 'horizontal', 'ASSET_BAD_CONTAINER'],
    ['multiple_video_streams.mp4', 'horizontal', 'ASSET_MULTIPLE_VIDEO_STREAMS'],
    ['valid_towers_ab_25.mp4', 'horizontal', 'ASSET_BAD_RESOLUTION'],
  ];
  it.each(casos)('%s (%s): %s → receta → OK', async (fixture, surface, code) => {
    const antes = await checkMedia(rt, new LocalPathSource(fx(fixture)), surface);
    expect(antes.ok ? 'OK' : antes.error.code).toBe(code);
    if (antes.ok) return;
    const rem = remediationFor(antes.error, surface);
    expect(rem.ffmpeg).toBeDefined();
    const out = path.join(dir, `${fixture}-${surface}.out.mp4`);
    const args = rem.ffmpeg!.args.map((a) => (a === INPUT_PLACEHOLDER ? fx(fixture) : a === OUTPUT_PLACEHOLDER ? out : a));
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { timeout: 60_000 });
    const despues = await checkMedia(rt, new LocalPathSource(out), surface);
    expect(despues.ok ? 'OK' : despues.error.code).toBe('OK');
  });
});
