import type { CampaignView } from '@trust/builder-repository';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CampaignStatusView } from './CampaignStatus';

/**
 * D3 (#15) — el indicador de campaña (§32): sin campaña no renderiza nada (el
 * Builder de M2C queda idéntico); con campaña muestra APPROVED VERSION vN,
 * WORKING DRAFT rev R, el estado y, ante un conflicto, las tres salidas de §9.
 */
const base: CampaignView = {
  campaignId: '44444444-4444-4444-8444-444444444444', phase: 'saved', connectivity: 'online', revision: 7, updatedAt: 't',
  approvedVersion: { id: 'v', versionNumber: 3, versionHash: 'abcdef0123456789' }, conflict: null, error: null, localCopy: null,
};
const html = (campaign: CampaignView | null) => renderToStaticMarkup(createElement(CampaignStatusView, { campaign, resolveConflict: async () => undefined })).replace(/<!-- -->/g, '');

describe('D3 · indicador de campaña del Builder', () => {
  it('sin campaña: no renderiza nada', () => {
    expect(html(null)).toBe('');
  });

  it('APPROVED VERSION vN y WORKING DRAFT rev R (§32)', () => {
    const h = html(base);
    expect(h).toContain('data-testid="approved-version"');
    expect(h).toContain('APPROVED VERSION v3');
    expect(h).toContain('WORKING DRAFT · rev 7');
    expect(h).toContain('SINCRONIZADO');
    expect(h).not.toContain('campaign-conflict');
  });

  it('sin versión aprobada: solo WORKING DRAFT', () => {
    const h = html({ ...base, approvedVersion: null });
    expect(h).not.toContain('APPROVED VERSION');
    expect(h).toContain('WORKING DRAFT');
  });

  it('pendiente sin conexión y error se ven', () => {
    expect(html({ ...base, phase: 'pending', connectivity: 'offline' })).toContain('PENDIENTE · SIN CONEXIÓN');
    const e = html({ ...base, phase: 'error', revision: null, error: { code: 'UNAUTHENTICATED', message: 'Iniciá sesión.' } });
    expect(e).toContain('ERROR · UNAUTHENTICATED');
    expect(e).toContain('Iniciá sesión.');
    expect(e).toContain('queda solo en este navegador');
  });

  it('conflicto: revisiones del servidor y del cliente, y las tres salidas de §9', () => {
    const h = html({ ...base, phase: 'conflict', conflict: { serverRevision: 9, clientRevision: 7, serverUpdatedAt: '2026-10-09T01:00:00.000Z' } });
    expect(h).toContain('CONFLICTO');
    expect(h).toMatch(/revisión 9/);
    for (const id of ['conflict-recover-server', 'conflict-keep-local', 'conflict-duplicate']) expect(h).toContain(`data-testid="${id}"`);
  });

  it('copia local de "duplicar": se ofrece para descargar', () => {
    expect(html({ ...base, localCopy: { name: 'x' } as CampaignView['localCopy'] })).toContain('data-testid="download-local-copy"');
  });
});
