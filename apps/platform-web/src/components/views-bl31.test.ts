import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { VersionSummary } from '../lib/api';
import { CampaignDetailView } from './CampaignDetail';
import { appendPage } from '../lib/version-history';
import { CampaignVersionsView, type CampaignVersionsViewProps } from './CampaignVersions';
import { VersionReviewView } from './VersionReview';

/**
 * BL-31 · vista del historial: más nueva primero, cada fila enlaza a su
 * revisión, estado en texto, "ver anteriores" solo con más páginas y errores
 * del servidor tal cual (una campaña ajena es un 404 del servidor).
 */
const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el).replace(/<!-- -->/g, '');
const U = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const v = (n: number, status: VersionSummary['status']): VersionSummary => ({
  id: U(n), versionNumber: n, versionHash: String(n).repeat(64).slice(0, 64), status, sourceDraftRevision: n + 1, submittedAt: `2026-10-0${n}T10:00:00.000Z`,
});
const props = (o: Partial<CampaignVersionsViewProps> = {}): CampaignVersionsViewProps => ({
  campaignId: U(9), items: [v(3, 'SUBMITTED'), v(2, 'APPROVED'), v(1, 'REJECTED')], hasMore: false, loadError: null,
  more: { busy: false, error: null }, onMore: () => undefined, ...o,
});

describe('BL-31 · historial de versiones (vista)', () => {
  it('filas en el orden del servidor, enlace a /versions/:id, estado en texto, hash completo y revisión del draft', () => {
    const h = html(createElement(CampaignVersionsView, props()));
    expect(h).toContain('<h1>Historial de versiones</h1>');
    const orden = [...h.matchAll(/<a href="\/versions\/([0-9a-f-]+)">v(\d+)<\/a>/g)].map((m) => [m[1], m[2]]);
    expect(orden).toEqual([[U(3), '3'], [U(2), '2'], [U(1), '1']]);
    expect(h).toContain(`<td>APPROVED</td><td><code class="hash">${'2'.repeat(64)}</code></td><td>2026-10-02T10:00:00.000Z</td><td>rev 3</td>`);
    expect(h).toContain('<td>REJECTED</td>');
    expect(h).toContain('<th scope="col">Estado</th>');
    expect(h).toContain('<caption class="sr-only">');
    expect(h).not.toContain('Ver versiones anteriores');
  });

  it('"Ver versiones anteriores" solo si hay más páginas; deshabilitado y aria-busy mientras carga', () => {
    expect(html(createElement(CampaignVersionsView, props({ hasMore: true })))).toContain('<button type="button" aria-busy="false">Ver versiones anteriores</button>');
    expect(html(createElement(CampaignVersionsView, props({ hasMore: true, more: { busy: true, error: null } })))).toContain('<button type="button" disabled="" aria-busy="true">Cargando…</button>');
    expect(html(createElement(CampaignVersionsView, props({ hasMore: true, more: { busy: false, error: 'El cursor no corresponde a este historial. (INVALID_CURSOR)' } }))))
      .toContain('<p role="alert" class="error">El cursor no corresponde a este historial. (INVALID_CURSOR)</p>');
  });

  it('vacía, cargando y error de carga (p. ej. 404 de una campaña fuera de scope) sin filas', () => {
    expect(html(createElement(CampaignVersionsView, props({ items: [] })))).toContain('La campaña todavía no tiene versiones enviadas.');
    expect(html(createElement(CampaignVersionsView, props({ items: null })))).toContain('<p role="status">Cargando historial…</p>');
    const err = html(createElement(CampaignVersionsView, props({ loadError: 'La campaña no existe. (CAMPAIGN_NOT_FOUND · req-1)' })));
    expect(err).toContain('<p role="alert" class="error">La campaña no existe. (CAMPAIGN_NOT_FOUND · req-1)</p>');
    expect(err).not.toContain('/versions/');
  });

  it('appendPage no repite ids si la misma página llega dos veces', () => {
    const a = [v(3, 'SUBMITTED'), v(2, 'APPROVED')];
    expect(appendPage(a, [v(2, 'APPROVED'), v(1, 'REJECTED')]).map((x) => x.versionNumber)).toEqual([3, 2, 1]);
  });

  it('navegación: el detalle de campaña y la revisión de una versión enlazan al historial de SU campaña', () => {
    const nada = () => undefined;
    const det = html(createElement(CampaignDetailView, {
      campaign: { id: U(9), contractId: U(5), name: 'C', lifecycleStatus: 'ACTIVE', currentDraft: null, latestApprovedVersion: null, createdAt: 't', updatedAt: 't' },
      draft: { campaignId: U(9), draftId: U(8), revision: 1, updatedAt: 't', takeoverDraft: {} }, assets: [], builderUrl: null, loadError: null,
      upload: { surfaceType: 'horizontal', fileName: null, busy: false, error: null, last: null }, assign: { busy: false, error: null }, submit: { busy: false, error: null, version: null },
      onSurfaceType: nada, onFile: nada, onUpload: nada, onAssign: nada, onSubmit: nada,
    }));
    expect(det).toContain(`<a href="/campaigns/${U(9)}/versions" data-testid="versions-link">Historial de versiones</a>`);
    const rev = html(createElement(VersionReviewView, {
      version: { id: U(3), campaignId: U(9), contractId: U(5), versionNumber: 3, versionHash: 'c'.repeat(64), sourceDraftRevision: 1, submittedBy: U(1), submittedAt: 't', status: 'SUBMITTED', fourEyesRequired: true, approval: null, evidence: [], assets: [] },
      loadError: null, evidenceUrl: () => '', evidence: { type: 'PDF', fileName: null, busy: false, error: null },
      decision: { evidenceId: '', confirmHash: false, reason: '', busy: false, error: null },
      onEvidenceType: nada, onEvidenceFile: nada, onUploadEvidence: nada, onDecisionEvidence: nada, onConfirmHash: nada, onReason: nada, onApprove: nada, onReject: nada,
    }));
    expect(rev).toContain(`<a href="/campaigns/${U(9)}/versions" data-testid="versions-link">Historial de versiones de la campaña</a>`);
  });
});
