import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { type Campaign, PlatformApiError } from '../lib/api';
import { CampaignsView, type CampaignsViewProps } from './Campaigns';
import { LoginFormView } from './LoginForm';
import { ErrorMessage, describeError } from './ui';

/**
 * E3a · vistas de platform-web. Accesibilidad básica (BL-28): etiquetas
 * asociadas, autocompletado, errores con role="alert", estados con role="status".
 * axe y el recorrido con teclado en navegador son de E3c.
 */
const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el).replace(/<!-- -->/g, '');
const nada = () => undefined;

const CAMPAIGN: Campaign = {
  id: '22222222-2222-4222-8222-222222222222', contractId: '33333333-3333-4333-8333-333333333333', name: 'Launch', lifecycleStatus: 'ACTIVE',
  currentDraft: { id: '44444444-4444-4444-8444-444444444444', revision: 2, updatedAt: 't' },
  latestApprovedVersion: { id: '55555555-5555-4555-8555-555555555555', versionNumber: 3, versionHash: 'ab'.repeat(32) },
  createdAt: 't', updatedAt: 't',
};
const props = (o: Partial<CampaignsViewProps> = {}): CampaignsViewProps => ({
  campaigns: [CAMPAIGN],
  contracts: [{ id: CAMPAIGN.contractId, advertiserId: CAMPAIGN.contractId, name: 'Takeover 2026', status: 'ACTIVE', startsAt: 't', endsAt: 't' }],
  loadError: null,
  form: { contractId: '', name: '', submitting: false, error: null, created: null },
  onContract: nada, onName: nada, onCreate: nada,
  ...o,
});

describe('E3a · login', () => {
  it('etiquetas asociadas a sus campos, autocompletado y sin error de entrada', () => {
    const h = html(createElement(LoginFormView, { email: '', password: '', submitting: false, error: null, onEmail: nada, onPassword: nada, onSubmit: nada }));
    expect(h).toContain('<label for="login-email">Email</label>');
    expect(h).toContain('id="login-email"');
    expect(h).toMatch(/autocomplete="username"/i);
    expect(h).toMatch(/autocomplete="current-password"/i);
    expect(h).toContain('<label for="login-password">Contraseña</label>');
    expect(h).toContain('type="password"');
    expect(h).not.toContain('role="alert"');
  });

  it('error del servidor anunciado con role="alert"; enviando → botón deshabilitado y aria-busy', () => {
    const h = html(createElement(LoginFormView, { email: 'op@x', password: 'x', submitting: true, error: 'Email o contraseña incorrectos. (INVALID_CREDENTIALS)', onEmail: nada, onPassword: nada, onSubmit: nada }));
    expect(h).toContain('<p role="alert" class="error">Email o contraseña incorrectos. (INVALID_CREDENTIALS)</p>');
    expect(h).toMatch(/<button type="submit" disabled="" aria-busy="true">Ingresando…<\/button>/);
  });
});

describe('E3a · campañas', () => {
  it('lista con contrato, working draft y APPROVED VERSION con el hash completo', () => {
    const h = html(createElement(CampaignsView, props()));
    expect(h).toContain('<td><a href="/campaigns/22222222-2222-4222-8222-222222222222">Launch</a></td>');
    expect(h).toContain('<td>Takeover 2026</td>');
    expect(h).toContain('rev 2');
    expect(h).toContain(`APPROVED VERSION v3 · <code class="hash">${'ab'.repeat(32)}</code>`);
    expect(h).toContain('<th scope="col">Versión aprobada</th>');
  });

  it('sin versión aprobada ni draft; lista vacía; cargando; error de carga con role="alert"', () => {
    expect(html(createElement(CampaignsView, props({ campaigns: [{ ...CAMPAIGN, currentDraft: null, latestApprovedVersion: null }] })))).toContain('sin versión aprobada');
    expect(html(createElement(CampaignsView, props({ campaigns: [] })))).toContain('Todavía no hay campañas.');
    expect(html(createElement(CampaignsView, props({ campaigns: null })))).toContain('<p role="status">Cargando campañas…</p>');
    const err = html(createElement(CampaignsView, props({ campaigns: null, loadError: 'Sin permiso. (FORBIDDEN)' })));
    expect(err).toContain('<p role="alert" class="error">Sin permiso. (FORBIDDEN)</p>');
    expect(err).not.toContain('Cargando campañas');
  });

  it('alta: select de contratos etiquetado, botón deshabilitado sin contrato o nombre, error y confirmación', () => {
    const vacio = html(createElement(CampaignsView, props()));
    expect(vacio).toContain('<label for="campaign-contract">Contrato</label>');
    expect(vacio).toContain('<option value="33333333-3333-4333-8333-333333333333">Takeover 2026 (ACTIVE)</option>');
    expect(vacio).toMatch(/<button type="submit" disabled="" aria-busy="false">Crear campaña<\/button>/);
    const listo = html(createElement(CampaignsView, props({ form: { contractId: CAMPAIGN.contractId, name: 'Nueva', submitting: false, error: 'No. (FORBIDDEN)', created: 'Vieja' } })));
    expect(listo).toMatch(/<button type="submit" aria-busy="false">Crear campaña<\/button>/);
    expect(listo).toContain('<p role="alert" class="error">No. (FORBIDDEN)</p>');
    expect(listo).toContain('<p role="status">Campaña «Vieja» creada.</p>');
  });
});

describe('E3a · errores', () => {
  it('se muestra el mensaje y el código del servidor; nada interno si no es un error de la API', () => {
    expect(describeError(new PlatformApiError(409, 'DRAFT_CONFLICT', 'Otro guardó antes.', 'req-1'))).toBe('Otro guardó antes. (DRAFT_CONFLICT · req-1)');
    expect(describeError(new PlatformApiError(0, 'NETWORK_ERROR', 'No se pudo conectar con la API.'))).toBe('No se pudo conectar con la API. (NETWORK_ERROR)');
    expect(describeError(new Error('stack /srv/app.ts:12'))).toBe('Error inesperado.');
    expect(html(createElement(ErrorMessage, { message: null }))).toBe('');
  });
});
