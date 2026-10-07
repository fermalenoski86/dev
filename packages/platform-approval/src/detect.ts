import type { EvidenceType } from '@trust/platform-db';

/**
 * Detección del contenido de la evidencia por BYTES REALES — decisión 2 del
 * brief C (§19).
 *
 * Ni el MIME que declara el cliente (`Content-Type` de la parte multipart) ni
 * la extensión del nombre deciden nada: se miran los bytes. Allowlist CERRADA,
 * sin ejecutar ni interpretar el contenido:
 *
 *   PDF      %PDF- en el byte 0                         → application/pdf
 *   EMAIL    texto UTF-8 con encabezados RFC 5322       → message/rfc822
 *            (From: y además Date: o Subject:, antes de la primera línea vacía)
 *   MESSAGE  texto UTF-8 sin encabezados de email       → text/plain
 *   OTHER    NINGUNO en C2 (auditoría C2 #1): una firma de imagen (PNG,
 *            JPEG) no demuestra que el archivo entero sea una imagen inerte;
 *            sin un decoder real que valide el archivo completo, OTHER queda
 *            fuera de la allowlist. Una imagen se rechaza como cualquier binario.
 *
 * "Texto" = UTF-8 válido en TODO el archivo, sin NUL ni controles C0 salvo
 * TAB/LF/CR/FF. Un texto que un navegador interpretaría como HTML/XML/SVG
 * (algoritmo de sniffing de WHATWG) NO es texto aceptable: se rechaza aunque
 * se sirva como descarga. Todo lo demás (ZIP/Office, ejecutables, HTML, SVG,
 * binarios desconocidos) queda afuera.
 *
 * La clasificación depende SOLO de los bytes: los mismos bytes dan siempre el
 * mismo MIME (el StoredObject es único por sha256). Si el tipo declarado no es
 * el detectado, es EVIDENCE_TYPE_MISMATCH; si el contenido no está en la
 * allowlist, EVIDENCE_UNSUPPORTED_CONTENT.
 */
export type DetectedKind = 'PDF' | 'EMAIL' | 'MESSAGE';

export const MIME_BY_KIND: Readonly<Record<DetectedKind, string>> = {
  PDF: 'application/pdf',
  EMAIL: 'message/rfc822',
  MESSAGE: 'text/plain',
};

export const TYPE_BY_KIND: Readonly<Record<DetectedKind, EvidenceType>> = {
  PDF: 'PDF',
  EMAIL: 'EMAIL',
  MESSAGE: 'MESSAGE',
};

/** Extensión del nombre de DESCARGA, derivada del MIME validado (nunca del nombre original). */
export const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'message/rfc822': 'eml',
  'text/plain': 'txt',
};

/** Bytes del comienzo que se conservan para las firmas y los encabezados. */
export const HEAD_BYTES = 64 * 1024;

/**
 * Observa el stream mientras pasa (sin bufferear el archivo): guarda los
 * primeros HEAD_BYTES y valida incrementalmente que todo sea texto UTF-8.
 */
export class ContentSniffer {
  private readonly head: Buffer[] = [];
  private headLen = 0;
  private readonly decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  private text = true;

  push(chunk: Buffer): void {
    if (this.headLen < HEAD_BYTES) {
      const take = chunk.subarray(0, HEAD_BYTES - this.headLen);
      this.head.push(take);
      this.headLen += take.length;
    }
    if (!this.text) return;
    try {
      if (!esTextoSeguro(this.decoder.decode(chunk, { stream: true }))) this.text = false;
    } catch {
      this.text = false;
    }
  }

  /** Cierra la validación de texto (un multibyte cortado al final no es UTF-8 válido). */
  finish(): { head: Buffer; isText: boolean } {
    if (this.text) {
      try {
        if (!esTextoSeguro(this.decoder.decode())) this.text = false;
      } catch {
        this.text = false;
      }
    }
    return { head: Buffer.concat(this.head), isText: this.text };
  }
}

// Controles C0 y DEL, salvo TAB (09), LF (0A), FF (0C) y CR (0D).
// eslint-disable-next-line no-control-regex
const CONTROL_PROHIBIDO = /[\u0000-\u0008\u000b\u000e-\u001f\u007f]/;
const esTextoSeguro = (s: string) => !CONTROL_PROHIBIDO.test(s);

/**
 * Patrones de WHATWG MIME Sniffing §7.1 ("identifying a resource with an
 * unknown MIME type") para HTML y XML, más SVG: después de espacios iniciales,
 * sin distinguir mayúsculas, seguidos de espacio o `>`; `<!--` y `<?xml` alcanzan.
 */
const HTML_TAGS = ['!DOCTYPE HTML', 'HTML', 'HEAD', 'SCRIPT', 'IFRAME', 'H1', 'DIV', 'FONT', 'TABLE', 'A', 'STYLE', 'TITLE', 'B', 'BODY', 'BR', 'P', 'SVG'];

export function looksLikeMarkup(text: string): boolean {
  const t = text.replace(/^\uFEFF/, '').replace(/^[\t\n\f\r ]+/, '');
  if (/^<\?xml/i.test(t) || t.startsWith('<!--')) return true;
  if (!t.startsWith('<')) return false;
  const resto = t.slice(1).toUpperCase();
  // WHATWG: el patrón termina en un "tag-terminating byte" (espacio o `>`)
  return HTML_TAGS.some((tag) => resto.startsWith(tag) && [' ', '>'].includes(resto.charAt(tag.length)));
}

// field-name de RFC 5322 §3.6.8: ASCII imprimible salvo ":".
const ENCABEZADO = /^([\x21-\x39\x3b-\x7e]+):/;

/**
 * ¿Empieza con un bloque de encabezados RFC 5322 de un mensaje real? Cada línea
 * hasta la primera vacía es un encabezado o su continuación (espacio/tab
 * inicial), y aparecen From: y además Date: o Subject:.
 */
export function looksLikeEmail(text: string): boolean {
  const t = text.replace(/^\uFEFF/, '');
  const lineas = t.split(/\r?\n/);
  const nombres = new Set<string>();
  let vistas = 0;
  for (const l of lineas) {
    if (l === '') break;
    if (/^[ \t]/.test(l)) {
      if (vistas === 0) return false;
      continue;
    }
    const m = ENCABEZADO.exec(l);
    if (!m) return false;
    nombres.add((m[1] as string).toLowerCase());
    vistas++;
  }
  // el bloque tiene que terminar en una línea vacía dentro de lo que se miró
  if (!lineas.includes('')) return false;
  return nombres.has('from') && (nombres.has('date') || nombres.has('subject'));
}

/** Clasifica por bytes. null = fuera de la allowlist. */
export function classifyContent(s: { head: Buffer; isText: boolean }): DetectedKind | null {
  const { head } = s;
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return 'PDF';
  if (!s.isText) return null;
  // El head puede cortar un multibyte al final: decodificarlo sin fatal no
  // cambia nada, porque la validez del archivo entero ya la decidió isText.
  const texto = new TextDecoder('utf-8', { fatal: false }).decode(head);
  if (texto.trim() === '') return null;
  if (looksLikeMarkup(texto)) return null;
  return looksLikeEmail(texto) ? 'EMAIL' : 'MESSAGE';
}
