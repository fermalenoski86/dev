import { describe, expect, it } from 'vitest';
import { ContentSniffer, HEAD_BYTES, classifyContent, looksLikeEmail, looksLikeMarkup } from './detect';

const sniff = (...chunks: Array<Buffer | string>) => {
  const s = new ContentSniffer();
  for (const c of chunks) s.push(Buffer.isBuffer(c) ? c : Buffer.from(c, 'utf8'));
  return s.finish();
};
const clasificar = (...chunks: Array<Buffer | string>) => classifyContent(sniff(...chunks));

const EMAIL = 'From: Cliente <ok@cliente.com>\r\nTo: trust@affinitas.com\r\nSubject: Aprobado\r\nDate: Wed, 7 Oct 2026 10:00:00 -0300\r\n\r\nAprobamos la versión 3.\r\n';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);

describe('CRITERIO C2: evidencia — detección por bytes reales (allowlist cerrada)', () => {
  it('PDF, PNG y JPEG por firma; el nombre o MIME declarado no participa', () => {
    expect(clasificar('%PDF-1.7\n%âãÏÓ\n1 0 obj\n')).toBe('PDF');
    expect(clasificar(PNG)).toBe('PNG');
    expect(clasificar(JPEG)).toBe('JPEG');
  });

  it('email RFC 5322 (From + Subject/Date antes de la línea vacía) → EMAIL; texto común → MESSAGE', () => {
    expect(clasificar(EMAIL)).toBe('EMAIL');
    expect(clasificar('[7/10/26 10:01] Cliente: dale, aprobado 👍\n')).toBe('MESSAGE');
    // encabezados sin From: no es un email
    expect(clasificar('Subject: hola\r\nDate: hoy\r\n\r\ncuerpo')).toBe('MESSAGE');
    // From: sin bloque terminado en línea vacía no es un email
    expect(looksLikeEmail('From: a@b.c\nSubject: x')).toBe(false);
  });

  it('HTML, SVG y XML disfrazados de texto se rechazan (sniffing WHATWG)', () => {
    for (const t of ['<html><script>alert(1)</script>', '  \n<!DOCTYPE html>\n<p>x', '<svg xmlns="http://www.w3.org/2000/svg">', '<?xml version="1.0"?>', '﻿<SCRIPT >x', '<!-- c -->']) {
      expect(looksLikeMarkup(t), t).toBe(true);
      expect(clasificar(t), t).toBeNull();
    }
    expect(looksLikeMarkup('<juan@cliente.com> escribió: ok')).toBe(false);
  });

  it('binarios, UTF-8 inválido, NUL y controles quedan afuera', () => {
    expect(clasificar(Buffer.from('PK\x03\x04docx', 'latin1'))).toBeNull(); // ZIP / Office
    expect(clasificar(Buffer.from('MZ\x90\x00', 'latin1'))).toBeNull(); // ejecutable PE
    expect(clasificar(Buffer.from([0x68, 0x6f, 0x6c, 0x61, 0xc3]))).toBeNull(); // multibyte cortado al final
    expect(clasificar('hola\u0000mundo')).toBeNull();
    expect(clasificar('hola\u001bmundo')).toBeNull();
    expect(clasificar('   \n\t ')).toBeNull(); // solo espacios: no es evidencia
  });

  it('la validez de texto se decide sobre TODO el archivo, también lo que pasa del head', () => {
    const relleno = 'a'.repeat(HEAD_BYTES + 10);
    expect(clasificar(relleno, 'fin ok\n')).toBe('MESSAGE');
    expect(clasificar(relleno, Buffer.from([0x00]))).toBeNull();
  });

  it('un multibyte partido entre dos chunks es UTF-8 válido', () => {
    const ene = Buffer.from('ñ', 'utf8');
    expect(clasificar(Buffer.concat([Buffer.from('mañana '), ene.subarray(0, 1)]), Buffer.concat([ene.subarray(1), Buffer.from(' ok')]))).toBe('MESSAGE');
  });
});
