import { describe, expect, it } from 'vitest';
import { MAX_FILENAME_CHARS, contentDispositionFor, displayFilename, normalizeOriginalFilename } from './filename';

describe('CRITERIO: filename — metadata, nunca path (§7)', () => {
  const hostiles: Array<[string, string, string]> = [
    ['../../etc/passwd', '../../etc/passwd', 'passwd'],
    ['..\\..\\Windows\\system32\\x.mp4', '..\\..\\Windows\\system32\\x.mp4', 'x.mp4'],
    ['a\u0000b.mp4', 'ab.mp4', 'ab.mp4'],
    ['factura\u202efdp.exe', 'facturafdp.exe', 'facturafdp.exe'],
    ['video.mp4.exe.mp4', 'video.mp4.exe.mp4', 'video.mp4.exe.mp4'],
    ['  \u0007\u0008  ', 'archivo', 'archivo'],
    ['', 'archivo', 'archivo'],
    ['..', '..', 'archivo'],
    ['.htaccess', '.htaccess', 'htaccess'],
    ['Campaña Ñandú 2026.mp4', 'Campaña Ñandú 2026.mp4', 'Campana Nandu 2026.mp4'],
    ['clip"; rm -rf /.mp4', 'clip"; rm -rf /.mp4', 'mp4'],
    ['$(touch PWNED)`id`.mp4', '$(touch PWNED)`id`.mp4', '_touch PWNED_id_.mp4'],
  ];
  it.each(hostiles)('%j → guardado %j, display %j', (raw, guardado, display) => {
    expect(normalizeOriginalFilename(raw)).toBe(guardado);
    expect(displayFilename(raw)).toBe(display);
    expect(displayFilename(raw)).toMatch(/^[A-Za-z0-9._ -]+$/);
    expect(displayFilename(raw)).not.toMatch(/[/\\]/);
  });

  it('NFC: misma forma visual, mismo valor guardado', () => {
    expect(normalizeOriginalFilename('n\u0303.mp4')).toBe('ñ.mp4');
  });

  it('máximo 255 caracteres sin partir pares sustitutos', () => {
    const largo = '🎬'.repeat(300);
    const r = normalizeOriginalFilename(largo);
    expect(Array.from(r)).toHaveLength(MAX_FILENAME_CHARS);
    expect(r.length).toBe(MAX_FILENAME_CHARS * 2);
    expect(r).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
  });

  it('Content-Disposition: sin comillas ni saltos inyectables, UTF-8 codificado', () => {
    const h = contentDispositionFor('a"\r\nSet-Cookie: x=1.mp4');
    expect(h).not.toMatch(/[\r\n]/);
    expect(h.match(/"/g)).toHaveLength(2);
    expect(contentDispositionFor('Ñandú.mp4')).toBe(`attachment; filename="Nandu.mp4"; filename*=UTF-8''%C3%91and%C3%BA.mp4`);
  });
});
