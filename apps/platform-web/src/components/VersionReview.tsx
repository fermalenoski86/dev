'use client';

import { useCallback, useEffect, useState } from 'react';
import { EVIDENCE_TYPES, type EvidenceType, type ShowVersion } from '../lib/api';
import { useSession } from './SessionGate';
import { ErrorMessage, describeError } from './ui';

export interface VersionReviewViewProps {
  version: ShowVersion | null;
  loadError: string | null;
  evidenceUrl: (evidenceId: string) => string;
  evidence: { type: EvidenceType; fileName: string | null; busy: boolean; error: string | null };
  decision: { evidenceId: string; confirmHash: boolean; reason: string; busy: boolean; error: string | null };
  onEvidenceType: (t: EvidenceType) => void;
  onEvidenceFile: (f: File | null) => void;
  onUploadEvidence: () => void;
  onDecisionEvidence: (id: string) => void;
  onConfirmHash: (v: boolean) => void;
  onReason: (v: string) => void;
  onApprove: () => void;
  onReject: () => void;
}

/**
 * Revisión de una versión (E3b): hash exacto, assets, evidencia y decisión.
 * La UI cita el hash que muestra; cuatro ojos, permisos y hash los decide el
 * servidor y sus errores se muestran tal cual.
 */
export function VersionReviewView(p: VersionReviewViewProps) {
  if (p.loadError) {
    return (
      <main className="page" id="contenido">
        <ErrorMessage message={p.loadError} />
      </main>
    );
  }
  const v = p.version;
  if (!v) {
    return (
      <main className="page" id="contenido" aria-busy="true">
        <p role="status">Cargando versión…</p>
      </main>
    );
  }
  const abierta = v.status === 'SUBMITTED';
  return (
    <main className="page" id="contenido">
      <h1>Versión v{v.versionNumber}</h1>
      <section aria-labelledby="version-datos" className="card">
        <h2 id="version-datos">Versión enviada</h2>
        <p data-testid="version-status">
          Estado: <strong>{v.status}</strong>
          {v.fourEyesRequired ? ' · cuatro ojos: quien envió no puede aprobar' : ''}
        </p>
        <p>
          Hash (sha256): <code className="hash" data-testid="version-hash">{v.versionHash}</code>
        </p>
        <p>
          Enviada {v.submittedAt} desde el draft rev {v.sourceDraftRevision}.
        </p>
        <p>
          <a href={`/campaigns/${v.campaignId}/versions`} data-testid="versions-link">
            Historial de versiones de la campaña
          </a>
        </p>
        {v.approval ? (
          <p role="status" data-testid="version-decision">
            {v.approval.decision} el {v.approval.createdAt} sobre el hash <code className="hash">{v.approval.versionHash}</code>
            {v.approval.reason ? ` · motivo: ${v.approval.reason}` : ''}
          </p>
        ) : null}
        <h3>Assets</h3>
        <ul>
          {v.assets.map((a) => (
            <li key={a.logicalRef}>
              {a.logicalRef}: <code className="hash">{a.sha256}</code>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="evidencia" className="card">
        <h2 id="evidencia">Evidencia</h2>
        {v.evidence.length === 0 ? <p>Sin evidencia adjunta.</p> : null}
        {v.evidence.length > 0 ? (
          <ul>
            {v.evidence.map((e) => (
              <li key={e.id}>
                {e.type} · <a href={p.evidenceUrl(e.id)}>{e.originalFilename}</a> · SHA-256 <code className="hash">{e.sha256}</code>
              </li>
            ))}
          </ul>
        ) : null}
        {abierta ? (
          <form
            aria-labelledby="adjuntar"
            onSubmit={(e) => {
              e.preventDefault();
              p.onUploadEvidence();
            }}
          >
            <h3 id="adjuntar">Adjuntar evidencia</h3>
            <label htmlFor="evidence-type">Tipo</label>
            <select id="evidence-type" value={p.evidence.type} onChange={(e) => p.onEvidenceType(e.target.value as EvidenceType)}>
              {EVIDENCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <label htmlFor="evidence-file">Archivo (PDF, email .eml o texto)</label>
            <input id="evidence-file" type="file" onChange={(e) => p.onEvidenceFile(e.target.files?.[0] ?? null)} />
            <ErrorMessage message={p.evidence.error} />
            <button type="submit" disabled={p.evidence.busy || !p.evidence.fileName} aria-busy={p.evidence.busy}>
              {p.evidence.busy ? 'Adjuntando…' : 'Adjuntar'}
            </button>
          </form>
        ) : null}
      </section>

      {abierta ? (
        <section aria-labelledby="decidir" className="card">
          <h2 id="decidir">Decisión</h2>
          <label htmlFor="decision-evidence">Evidencia de la aprobación</label>
          <select id="decision-evidence" value={p.decision.evidenceId} onChange={(e) => p.onDecisionEvidence(e.target.value)}>
            <option value="">Elegí una evidencia…</option>
            {v.evidence.map((e) => (
              <option key={e.id} value={e.id}>
                {e.type} · {e.originalFilename}
              </option>
            ))}
          </select>
          <div className="check">
            <input id="confirm-hash" type="checkbox" checked={p.decision.confirmHash} onChange={(e) => p.onConfirmHash(e.target.checked)} />
            <label htmlFor="confirm-hash">
              Apruebo exactamente la versión con hash <code className="hash">{v.versionHash}</code>
            </label>
          </div>
          <ErrorMessage message={p.decision.error} />
          <button type="button" onClick={p.onApprove} disabled={p.decision.busy || !p.decision.evidenceId || !p.decision.confirmHash} aria-busy={p.decision.busy}>
            Aprobar
          </button>
          <label htmlFor="reject-reason">Motivo del rechazo</label>
          <textarea id="reject-reason" maxLength={2000} value={p.decision.reason} onChange={(e) => p.onReason(e.target.value)} />
          <button type="button" className="secondary" onClick={p.onReject} disabled={p.decision.busy || !p.decision.reason.trim()}>
            Rechazar
          </button>
        </section>
      ) : null}
    </main>
  );
}

export function VersionReview({ versionId }: { versionId: string }) {
  const { client } = useSession();
  const [version, setVersion] = useState<ShowVersion | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [evType, setEvType] = useState<EvidenceType>('PDF');
  const [evFile, setEvFile] = useState<File | null>(null);
  const [evidence, setEvidence] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const [evidenceId, setEvidenceId] = useState('');
  const [confirmHash, setConfirmHash] = useState(false);
  const [reason, setReason] = useState('');
  const [decision, setDecision] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  const cargar = useCallback(async () => {
    try {
      setVersion(await client.getVersion(versionId));
      setLoadError(null);
    } catch (e) {
      setLoadError(describeError(e));
    }
  }, [client, versionId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const onUploadEvidence = async () => {
    if (!evFile || evidence.busy) return;
    setEvidence({ busy: true, error: null });
    try {
      const ev = await client.uploadEvidence(versionId, { type: evType, file: evFile, filename: evFile.name });
      setEvidenceId(ev.id);
      setEvidence({ busy: false, error: null });
      await cargar();
    } catch (e) {
      setEvidence({ busy: false, error: describeError(e) });
    }
  };

  const decidir = async (accion: 'approve' | 'reject') => {
    if (!version || decision.busy) return;
    setDecision({ busy: true, error: null });
    try {
      const v =
        accion === 'approve'
          ? await client.approve(versionId, { evidenceId, versionHash: version.versionHash })
          : await client.reject(versionId, { reason: reason.trim(), versionHash: version.versionHash });
      setVersion(v);
      setDecision({ busy: false, error: null });
    } catch (e) {
      setDecision({ busy: false, error: describeError(e) });
    }
  };

  return (
    <VersionReviewView
      version={version}
      loadError={loadError}
      evidenceUrl={(id) => client.evidenceUrl(versionId, id)}
      evidence={{ type: evType, fileName: evFile?.name ?? null, ...evidence }}
      decision={{ evidenceId, confirmHash, reason, ...decision }}
      onEvidenceType={setEvType}
      onEvidenceFile={setEvFile}
      onUploadEvidence={() => void onUploadEvidence()}
      onDecisionEvidence={setEvidenceId}
      onConfirmHash={setConfirmHash}
      onReason={setReason}
      onApprove={() => void decidir('approve')}
      onReject={() => void decidir('reject')}
    />
  );
}
