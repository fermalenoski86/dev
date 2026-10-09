import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Asset, Campaign, Draft, ShowVersion } from '../lib/api';
import { CampaignDetailView, type CampaignDetailViewProps } from './CampaignDetail';
import { VersionReviewView, type VersionReviewViewProps } from './VersionReview';

/**
 * E3b · vistas: APPROVED VERSION con hash exacto y WORKING DRAFT separados
 * (§32), assets READY/REJECTED con motivo y SHA-256, hash visible tras el
 * envío (§41), y una decisión que cita el hash mostrado.
 */
const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el).replace(/<!-- -->/g, '');
const nada = () => undefined;
const U = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const HASH_APROBADO = 'a'.repeat(64);
const HASH_NUEVO = 'b'.repeat(64);

const campaign: Campaign = {
  id: U(4), contractId: U(5), name: 'Lanzamiento', lifecycleStatus: 'ACTIVE',
  currentDraft: { id: U(8), revision: 3, updatedAt: '2026-10-09T20:00:00.000Z' },
  latestApprovedVersion: { id: U(9), versionNumber: 1, versionHash: HASH_APROBADO }, createdAt: 't', updatedAt: 't',
};
const ready: Asset = { id: U(2), status: 'READY', surfaceType: 'horizontal', originalFilename: 'h.mp4', sha256: 'd'.repeat(64), sizeBytes: 1, width: 1920, height: 412, fps: 30, codec: 'H264', durationMs: 15000, rejection: null };
const rejected: Asset = { ...ready, id: U(3), originalFilename: 'roto.mp4', status: 'REJECTED', sha256: null, width: null, height: null, fps: null, codec: null, durationMs: null, rejection: { code: 'ASSET_CORRUPT', message: 'No es un video legible.', remediation: { summary: 'Exportá de nuevo en MP4 H.264.' } } };
const draft: Draft = { campaignId: U(4), draftId: U(8), revision: 3, updatedAt: '2026-10-09T20:00:00.000Z', takeoverDraft: { surfaces: { upperMode: 'master', masterAssetId: null, horizontalAssetId: U(2) } } };
const version: ShowVersion = {
  id: U(7), campaignId: U(4), contractId: U(5), versionNumber: 2, versionHash: HASH_NUEVO, sourceDraftRevision: 3, submittedBy: U(1), submittedAt: 't',
  status: 'SUBMITTED', fourEyesRequired: true, approval: null,
  evidence: [{ id: U(6), showVersionId: U(7), type: 'PDF', originalFilename: 'ok.pdf', mimeType: 'application/pdf', sizeBytes: 9, sha256: 'e'.repeat(64), uploadedBy: U(1), uploadedAt: 't' }],
  assets: [{ logicalRef: 'horizontalAssetId', assetId: U(2), sha256: 'd'.repeat(64) }],
};

const detalle = (o: Partial<CampaignDetailViewProps> = {}): CampaignDetailViewProps => ({
  campaign, draft, assets: [ready, rejected], builderUrl: 'https://control.trust.test/?campaign=' + U(4), loadError: null,
  upload: { surfaceType: 'horizontal', fileName: null, busy: false, error: null, last: null },
  assign: { busy: false, error: null }, submit: { busy: false, error: null, version: null },
  onSurfaceType: nada, onFile: nada, onUpload: nada, onAssign: nada, onSubmit: nada, ...o,
});
const revision = (o: Partial<VersionReviewViewProps> = {}): VersionReviewViewProps => ({
  version, loadError: null, evidenceUrl: (id) => `https://api.trust.test/api/v1/show-versions/${U(7)}/evidence/${id}`,
  evidence: { type: 'PDF', fileName: null, busy: false, error: null },
  decision: { evidenceId: '', confirmHash: false, reason: '', busy: false, error: null },
  onEvidenceType: nada, onEvidenceFile: nada, onUploadEvidence: nada, onDecisionEvidence: nada, onConfirmHash: nada, onReason: nada, onApprove: nada, onReject: nada, ...o,
});

describe('E3b · detalle de campaña', () => {
  it('§32: APPROVED VERSION vN con el hash exacto y WORKING DRAFT rev R, separados; enlace al Builder con ?campaign=', () => {
    const h = html(createElement(CampaignDetailView, detalle()));
    expect(h).toContain(`<p data-testid="approved-version"><strong>APPROVED VERSION v1</strong> · hash <code class="hash">${HASH_APROBADO}</code></p>`);
    expect(h).toContain('<p data-testid="working-draft"><strong>WORKING DRAFT</strong> · rev 3 · actualizado 2026-10-09T20:00:00.000Z</p>');
    expect(h).toContain(`<a href="https://control.trust.test/?campaign=${U(4)}">Editar el draft en el Builder</a>`);
    expect(html(createElement(CampaignDetailView, detalle({ campaign: { ...campaign, latestApprovedVersion: null } })))).toContain('<strong>Sin versión aprobada</strong>');
    expect(html(createElement(CampaignDetailView, detalle({ builderUrl: null })))).toContain('requiere NEXT_PUBLIC_TRUST_BUILDER_URL');
  });

  it('assets: READY con formato y SHA-256 y botón para su ranura; REJECTED con código, motivo y remediación, sin botón', () => {
    const h = html(createElement(CampaignDetailView, detalle()));
    expect(h).toContain('READY · 1920×412 · 30 fps · H264');
    expect(h).toContain(`<code class="hash">${'d'.repeat(64)}</code>`);
    expect(h).toMatch(/<button type="button" disabled="">Asignado a Horizontal<\/button>/);
    expect(h).toContain('ASSET_CORRUPT: No es un video legible.');
    expect(h).toContain('<span class="muted">Exportá de nuevo en MP4 H.264.</span>');
    const otra = html(createElement(CampaignDetailView, detalle({ draft: { ...draft, takeoverDraft: { surfaces: { upperMode: 'master' } } } })));
    expect(otra).toMatch(/<button type="button">Usar en Horizontal<\/button>/);
  });

  it('ranuras del draft con el asset asignado (nombre + SHA-256) o "sin asignar"', () => {
    const h = html(createElement(CampaignDetailView, detalle()));
    expect(h).toContain(`<td>Horizontal</td><td>h.mp4 · ${'d'.repeat(64)}</td>`);
    expect(h).toContain('<td>Master A+B (torres)</td><td>sin asignar</td>');
  });

  it('subir: etiquetas, botón deshabilitado sin archivo; resultado REJECTED anunciado', () => {
    const vacio = html(createElement(CampaignDetailView, detalle()));
    expect(vacio).toContain('<label for="asset-file">Archivo MP4</label>');
    expect(vacio).toMatch(/<button type="submit" disabled="" aria-busy="false">Subir<\/button>/);
    const res = html(createElement(CampaignDetailView, detalle({ upload: { surfaceType: 'horizontal', fileName: 'x.mp4', busy: false, error: null, last: rejected } })));
    expect(res).toContain('<p role="status" data-testid="upload-result">«roto.mp4» REJECTED · No es un video legible.</p>');
  });

  it('§41 hash visible: después de enviar se muestra vN, el hash exacto y el enlace de revisión; los errores del submit con role="alert"', () => {
    const h = html(createElement(CampaignDetailView, detalle({ submit: { busy: false, error: null, version } })));
    expect(h).toContain(`Versión v2 enviada (SUBMITTED) · hash <code class="hash">${HASH_NUEVO}</code>`);
    expect(h).toContain(`<a href="/versions/${U(7)}">/versions/${U(7)}</a>`);
    expect(h).toContain('Enviar rev 3 a aprobación');
    const err = html(createElement(CampaignDetailView, detalle({ submit: { busy: false, error: 'El draft no pasa el preflight. (PREFLIGHT_FAILED)', version: null } })));
    expect(err).toContain('<p role="alert" class="error">El draft no pasa el preflight. (PREFLIGHT_FAILED)</p>');
  });

  it('cargando y error de carga', () => {
    expect(html(createElement(CampaignDetailView, detalle({ campaign: null })))).toContain('Cargando campaña…');
    expect(html(createElement(CampaignDetailView, detalle({ loadError: 'No existe. (CAMPAIGN_NOT_FOUND)' })))).toContain('role="alert"');
  });
});

describe('E3b · revisión de una versión', () => {
  it('hash exacto, estado, cuatro ojos, assets por SHA-256 y evidencia con descarga del host de la API', () => {
    const h = html(createElement(VersionReviewView, revision()));
    expect(h).toContain(`<code class="hash" data-testid="version-hash">${HASH_NUEVO}</code>`);
    expect(h).toContain('Estado: <strong>SUBMITTED</strong> · cuatro ojos: quien envió no puede aprobar');
    expect(h).toContain(`horizontalAssetId: <code class="hash">${'d'.repeat(64)}</code>`);
    expect(h).toContain(`<a href="https://api.trust.test/api/v1/show-versions/${U(7)}/evidence/${U(6)}">ok.pdf</a>`);
  });

  it('aprobar exige elegir evidencia y confirmar el hash mostrado; rechazar exige motivo', () => {
    const cerrado = html(createElement(VersionReviewView, revision()));
    expect(cerrado).toContain(`<label for="confirm-hash">Apruebo exactamente la versión con hash <code class="hash">${HASH_NUEVO}</code></label>`);
    expect(cerrado).toMatch(/<button type="button" disabled="" aria-busy="false">Aprobar<\/button>/);
    expect(cerrado).toMatch(/<button type="button" class="secondary" disabled="">Rechazar<\/button>/);
    const soloEvidencia = html(createElement(VersionReviewView, revision({ decision: { evidenceId: U(6), confirmHash: false, reason: '', busy: false, error: null } })));
    expect(soloEvidencia).toMatch(/disabled="" aria-busy="false">Aprobar/);
    const listo = html(createElement(VersionReviewView, revision({ decision: { evidenceId: U(6), confirmHash: true, reason: 'falta logo', busy: false, error: null } })));
    expect(listo).toMatch(/<button type="button" aria-busy="false">Aprobar<\/button>/);
    expect(listo).toMatch(/<button type="button" class="secondary">Rechazar<\/button>/);
  });

  it('error de cuatro ojos o de hash: el mensaje del servidor con role="alert"', () => {
    const h = html(createElement(VersionReviewView, revision({ decision: { evidenceId: U(6), confirmHash: true, reason: '', busy: false, error: 'Quien envió no puede aprobar. (FOUR_EYES_VIOLATION)' } })));
    expect(h).toContain('<p role="alert" class="error">Quien envió no puede aprobar. (FOUR_EYES_VIOLATION)</p>');
  });

  it('versión ya decidida: muestra la decisión y el hash citado, sin formularios', () => {
    const v: ShowVersion = { ...version, status: 'APPROVED', approval: { id: U(1), decision: 'APPROVED', actorUserId: U(2), evidenceId: U(6), reason: null, versionHash: HASH_NUEVO, createdAt: 'T' } };
    const h = html(createElement(VersionReviewView, revision({ version: v })));
    expect(h).toContain(`<p role="status" data-testid="version-decision">APPROVED el T sobre el hash <code class="hash">${HASH_NUEVO}</code></p>`);
    expect(h).not.toContain('Adjuntar evidencia');
    expect(h).not.toContain('>Aprobar<');
  });
});
