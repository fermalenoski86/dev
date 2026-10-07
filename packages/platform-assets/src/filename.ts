/**
 * Nombre original del archivo — M3A.1 Fase B §7.
 *
 * Se guarda como METADATA y nunca se usa para construir paths: el temporal se
 * nombra con un UUID del servidor y el blob final con su sha256.
 *
 *   normalizeOriginalFilename: lo que se guarda. Conserva lo que escribió el
 *     usuario (incluidos "../", "\" o extensiones múltiples, que acá son solo
 *     texto) pero saca lo que no es texto: NUL y controles C0/C1, y los
 *     caracteres de control bidireccional que permiten disfrazar extensiones
 *     ("factura\u202efdp.exe"). NFC, máximo 255 caracteres sin partir pares
 *     sustitutos.
 *   displayFilename: lo que va a logs, headers y nombres de descarga. Solo el
 *     último segmento y un alfabeto ASCII seguro.
 *   contentDispositionFor: header de descarga (RFC 6266 + RFC 5987).
 */
export const MAX_FILENAME_CHARS = 255;
const FALLBACK = 'archivo';

// C0, DEL, C1 y controles bidi / de formato invisibles.
// eslint-disable-next-line no-control-regex
const NO_TEXTO = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff\ufff9-\ufffb]/g;

export function normalizeOriginalFilename(raw: string): string {
  const limpio = (raw ?? '').normalize('NFC').replace(NO_TEXTO, '').trim();
  const chars = Array.from(limpio).slice(0, MAX_FILENAME_CHARS).join('');
  return chars.length > 0 ? chars : FALLBACK;
}

export function displayFilename(raw: string): string {
  const base = normalizeOriginalFilename(raw).split(/[/\\]/).pop() ?? '';
  const ascii = base
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[.\s]+/, '')
    .trim()
    .slice(0, 100);
  return ascii.length > 0 && !/^[._ -]+$/.test(ascii) ? ascii : FALLBACK;
}

export function contentDispositionFor(raw: string): string {
  const base = (normalizeOriginalFilename(raw).split(/[/\\]/).pop() ?? '') || FALLBACK;
  const rfc5987 = encodeURIComponent(base).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${displayFilename(raw)}"; filename*=UTF-8''${rfc5987}`;
}
