import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlatformApiError, type ActiveVersionChange, type Campaign, type Role, type VersionSummary } from '../lib/api';
import { ADMIN_NOTICE, ActiveVersionView, type ActiveVersionViewProps, mensajeError } from './ActiveVersion';

/**
 * F3(a) UI · vista de versión vigente (brief `docs/briefs/F3A_UI.md` §2–§4,
 * §6.1): render por rol y estado, botones solo donde corresponde, cuatro ojos
 * para quien tiene los dos roles, aviso administrativo siempre y estado en texto.
 */
const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el).replace(/<!-- -->/g, '');
const U = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const H = (n: number) => String(n).repeat(64).slice(0, 64);
const OP = U(1);
const AP = U(7);
const v = (n: number, status: VersionSummary['status']): VersionSummary => ({ id: U(n), versionNumber: n, versionHash: H(n), status, sourceDraftRevision: n, submittedAt: `2026-10-0${n}T10:00:00.000Z` });
const VERSIONS = [v(3, 'SUBMITTED'), v(2, 'APPROVED'), v(4, 'APPROVED')];
const campaign = (o: Partial<Campaign> = {}): Campaign => ({
  id: U(9), contractId: U(8), name: 'Lanzamiento', lifecycleStatus: 'ACTIVE', currentDraft: null,
  latestApprovedVersion: { id: U(4), versionNumber: 4, versionHash: H(4) }, activeVersion: null, pendingActiveVersionChange: null,
  createdAt: 't', updatedAt: 't', ...o,
});
const PEND = { id: U(5), toVersionId: U(2), toVersionHash: H(2), requestedBy: OP, requestedAt: '2026-10-12T00:00:00.000Z', expiresAt: '2026-10-13T00:00:00.000Z' };
const change = (o: Partial<ActiveVersionChange> = {}): ActiveVersionChange => ({
  id: U(5), campaignId: U(9), fromVersionId: U(4), toVersionId: U(2), toVersionHash: H(2), reason: 'error en el cierre', requestedBy: OP,
  requestedAt: '2026-10-12T00:00:00.000Z', expiresAt: '2026-10-13T00:00:00.000Z', status: 'PENDING', decidedBy: null, decidedAt: null, ...o,
});
const IDLE = { phase: 'idle' as const, message: null };
const props = (o: Partial<ActiveVersionViewProps> & { roles?: Role[]; meId?: string } = {}): ActiveVersionViewProps => ({
  me: { id: o.meId ?? OP, roles: o.roles ?? ['OPERATOR'] }, campaign: campaign(), loadError: null, versions: VERSIONS, history: [],
  historyHasMore: false, historyMore: { busy: false, error: null }, onMoreHistory: () => undefined,
  form: { versionId: '', reason: '' }, onForm: () => undefined, confirmOpen: false, onOpenConfirm: () => undefined, onCloseConfirm: () => undefined,
  ops: { request: IDLE, confirm: IDLE, cancel: IDLE }, notice: null, onRequest: () => undefined, onConfirm: () => undefined, onCancel: () => undefined,
  onRetry: () => undefined, onDiscard: () => undefined, now: Date.parse('2026-10-12T12:00:00.000Z'), ...o,
});
const conPendiente = (o: Partial<Campaign> = {}) => campaign({ activeVersion: { id: U(4), versionNumber: 4, versionHash: H(4) }, pendingActiveVersionChange: PEND, ...o });

describe('F3(a) UI · vista', () => {
  it('aviso administrativo SIEMPRE visible: con datos, cargando y con error', () => {
    for (const p of [props(), props({ campaign: null }), props({ loadError: 'La campaña no existe. (CAMPAIGN_NOT_FOUND)' })]) {
      expect(html(createElement(ActiveVersionView, p))).toContain(`<p data-testid="admin-notice"><strong>${ADMIN_NOTICE}</strong></p>`);
    }
    expect(ADMIN_NOTICE).toBe('Versión vigente administrativa: no despliega contenido al edificio.');
  });

  it('sin vigente: "Sin versión vigente" y la última aprobada aparte, con nombre propio', () => {
    const h = html(createElement(ActiveVersionView, props()));
    expect(h).toContain('<p data-testid="active-version">Sin versión vigente</p>');
    expect(h).toContain(`Última aprobada (dato aparte, no es la vigente): v4 · <code class="hash">${H(4)}</code>`);
  });

  it('OPERATOR sin pendiente: ve "Pedir" con SOLO las APPROVED que no son la vigente; no ve confirmar ni cancelar', () => {
    const h = html(createElement(ActiveVersionView, props({ campaign: campaign({ activeVersion: { id: U(4), versionNumber: 4, versionHash: H(4) } }) })));
    expect(h).toContain('Pedir un cambio de versión vigente');
    const opciones = [...h.matchAll(/<option value="([0-9a-f-]*)"/g)].map((m) => m[1]);
    expect(opciones).toEqual(['', U(2)]); // ni la SUBMITTED (v3) ni la vigente (v4)
    expect(h).not.toContain('Revisar y confirmar');
    expect(h).not.toContain('Cancelar pedido');
  });

  it('INTERNAL_APPROVER sin pendiente: no ve "Pedir"', () => {
    expect(html(createElement(ActiveVersionView, props({ roles: ['INTERNAL_APPROVER'], meId: AP })))).not.toContain('Pedir un cambio');
  });

  it('pendiente ajeno para INTERNAL_APPROVER: origen, destino, hashes, motivo, quién pidió (id corto con el completo en title), vencimiento y "Revisar y confirmar"', () => {
    const h = html(createElement(ActiveVersionView, props({ roles: ['INTERNAL_APPROVER'], meId: AP, campaign: conPendiente(), history: [change()] })));
    expect(h).toContain(`De <strong>v4</strong> (<code class="hash">${H(4)}</code>) a <strong>v2</strong> (<code class="hash">${H(2)}</code>)`);
    expect(h).toContain('Motivo: error en el cierre');
    expect(h).toContain(`<code class="hash" title="${OP}" data-full-id="${OP}">${OP.slice(0, 8)}</code>`);
    expect(h).toContain('Vence: 2026-10-13T00:00:00.000Z');
    expect(h).toContain('vence en ~12 h');
    expect(h).toContain('<button type="button">Revisar y confirmar</button>');
    expect(h).not.toContain('Cancelar pedido'); // ni pidió ni es ADMIN
    expect(h).not.toContain('Pedir un cambio');
  });

  it('paso de confirmación explícito: origen, destino, hashes y motivo, sin reescribir nada (❓4)', () => {
    const h = html(createElement(ActiveVersionView, props({ roles: ['INTERNAL_APPROVER'], meId: AP, campaign: conPendiente(), history: [change()], confirmOpen: true })));
    expect(h).toContain(`Vas a cambiar la vigente de <strong>v4</strong> (<code class="hash">${H(4)}</code>) a <strong>v2</strong> (<code class="hash">${H(2)}</code>). Motivo: error en el cierre`);
    expect(h).toContain('Confirmar cambio');
    expect(h).not.toMatch(/<input[^>]*confirm/i);
  });

  it('cuatro ojos: quien pidió con los DOS roles ve el pedido y "Lo tiene que confirmar otra persona", sin "Confirmar"; sí puede cancelar', () => {
    const h = html(createElement(ActiveVersionView, props({ roles: ['OPERATOR', 'INTERNAL_APPROVER'], meId: OP, campaign: conPendiente(), history: [change()] })));
    expect(h).toContain('<p data-testid="four-eyes-note">Lo tiene que confirmar otra persona.</p>');
    expect(h).not.toContain('Revisar y confirmar');
    expect(h).not.toContain('Confirmar cambio');
    expect(h).toContain('Cancelar pedido');
    expect(h).toContain('Pedido por <strong>Vos</strong>');
  });

  it('ADMIN que no pidió: puede confirmar y cancelar', () => {
    const h = html(createElement(ActiveVersionView, props({ roles: ['ADMIN'], meId: U(6), campaign: conPendiente(), history: [change()] })));
    expect(h).toContain('Revisar y confirmar');
    expect(h).toContain('Cancelar pedido');
  });

  it('campaña archivada: no se ofrece pedir', () => {
    const h = html(createElement(ActiveVersionView, props({ campaign: campaign({ lifecycleStatus: 'ARCHIVED' }) })));
    expect(h).not.toContain('Pedir un cambio');
    expect(h).toContain('La campaña está archivada');
  });

  it('historial con estado en TEXTO, origen → destino, quién decidió y "Ver pedidos anteriores" solo con más páginas', () => {
    const h = html(createElement(ActiveVersionView, props({
      history: [change({ status: 'CONFIRMED', decidedBy: AP, decidedAt: '2026-10-12T01:00:00.000Z' }), change({ id: U(3), status: 'EXPIRED', fromVersionId: null, decidedAt: 'x' })],
      historyHasMore: true,
    })));
    expect(h).toContain('<td>CONFIRMED</td><td>v4 → v2</td><td><strong>Vos</strong></td>');
    expect(h).toContain(`title="${AP}"`);
    expect(h).toContain('<td>EXPIRED</td><td>sin vigente → v2</td>');
    expect(h).toContain('<td>venció</td>');
    expect(h).toContain('Ver pedidos anteriores');
    expect(h).toContain('<caption class="sr-only">');
  });

  it('resultado incierto: "No sabemos si se aplicó" con Reintentar y Descartar; el formulario queda congelado', () => {
    const h = html(createElement(ActiveVersionView, props({
      form: { versionId: U(2), reason: 'r' }, ops: { request: { phase: 'uncertain', message: 'No se pudo conectar con la API. (NETWORK_ERROR)' }, confirm: IDLE, cancel: IDLE },
    })));
    expect(h).toContain('No sabemos si se aplicó. No se pudo conectar con la API. (NETWORK_ERROR)');
    expect(h).toContain('<button type="button">Reintentar</button>');
    expect(h).toContain('Descartar y volver a leer');
    expect(h).toMatch(/<select[^>]*disabled=""/);
    expect(h).toMatch(/<textarea[^>]*disabled=""/);
  });

  it('en vuelo: los botones quedan deshabilitados (sin doble envío)', () => {
    const h = html(createElement(ActiveVersionView, props({ roles: ['INTERNAL_APPROVER'], meId: AP, campaign: conPendiente(), history: [change()], confirmOpen: true, ops: { request: IDLE, confirm: { phase: 'inflight', message: null }, cancel: IDLE } })));
    expect(h).toContain('<button type="button" disabled="" aria-busy="true">Confirmando…</button>');
  });
});

describe('F3(a) UI · mensajes de los 409 (§4)', () => {
  const e = (code: string, details: Record<string, unknown> | null = null) => new PlatformApiError(409, code, 'msg del servidor', 'req-1', details);
  it('conflicto distingue pedir (no se creó nada) de confirmar (quedó cancelado); el texto del servidor va al final', () => {
    expect(mensajeError('request', e('ACTIVE_VERSION_CONFLICT'))).toBe('La vigente cambió mientras tanto: no se creó ningún pedido. msg del servidor (ACTIVE_VERSION_CONFLICT · req-1)');
    expect(mensajeError('confirm', e('ACTIVE_VERSION_CONFLICT'))).toMatch(/^La vigente cambió mientras tanto: el pedido quedó cancelado\./);
  });
  it('vencido, pendiente, sin cambio, hash, archivada y no pendiente', () => {
    expect(mensajeError('confirm', e('ACTIVE_VERSION_CHANGE_EXPIRED'))).toMatch(/^El pedido venció; hay que pedirlo de nuevo\./);
    expect(mensajeError('request', e('ACTIVE_VERSION_CHANGE_PENDING'))).toMatch(/^Ya hay un pedido pendiente\./);
    expect(mensajeError('request', e('ACTIVE_VERSION_UNCHANGED'))).toMatch(/^Esa versión ya es la vigente\./);
    expect(mensajeError('request', e('VERSION_HASH_MISMATCH'))).toMatch(/^La versión cambió desde que la viste; recargá\./);
    expect(mensajeError('request', e('INVALID_STATE_TRANSITION', { lifecycleStatus: 'ARCHIVED' }))).toMatch(/^La campaña está archivada\./);
    expect(mensajeError('confirm', e('INVALID_STATE_TRANSITION', { status: 'CANCELLED' }))).toMatch(/^El pedido ya no está pendiente\./);
    expect(mensajeError('confirm', new PlatformApiError(403, 'FOUR_EYES_VIOLATION', 'Quien pidió el cambio no puede confirmarlo.', 'r'))).toBe('Quien pidió el cambio no puede confirmarlo. (FOUR_EYES_VIOLATION · r)');
  });
});
