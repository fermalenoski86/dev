'use client';

import type { CampaignView } from '@trust/builder-repository';
import { useBuilderStore } from '../../state/useBuilderStore';

/**
 * D3 (#15, opción 1) — indicador de campaña del Builder (master §31, §32, §9).
 *
 * Sin campaña del backend (`?campaign=` ausente) no renderiza NADA: el Builder
 * de M2C queda idéntico. Con campaña muestra:
 *
 *   · APPROVED VERSION vN — solo lectura; el Builder nunca la modifica (§32);
 *   · WORKING DRAFT rev R — la revisión del servidor sobre la que se edita;
 *   · el estado del guardado (sincronizado, pendiente sin conexión, conflicto,
 *     error) y, ante un conflicto, las tres salidas de §9. Ninguna se toma sola.
 */
export function CampaignStatus() {
  const campaign = useBuilderStore((s) => s.campaign);
  const resolveConflict = useBuilderStore((s) => s.resolveConflict);
  return <CampaignStatusView campaign={campaign} resolveConflict={resolveConflict} />;
}

/** Presentación pura (se prueba sin store ni DOM). */
export function CampaignStatusView({
  campaign,
  resolveConflict,
}: {
  campaign: CampaignView | null;
  resolveConflict: (salida: 'server' | 'local' | 'duplicate') => Promise<void>;
}) {
  if (!campaign) return null;

  return (
    <div data-testid="campaign-status" className="flex flex-wrap items-center gap-1.5">
      {campaign.approvedVersion && (
        <span
          data-testid="approved-version"
          title={`Versión aprobada ${campaign.approvedVersion.versionHash.slice(0, 12)} · solo lectura`}
          className="rounded border border-emerald-900 bg-emerald-950/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400"
        >
          APPROVED VERSION v{campaign.approvedVersion.versionNumber}
        </span>
      )}
      <span
        data-testid="working-draft"
        className="rounded border border-sky-900 bg-sky-950/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-300"
      >
        WORKING DRAFT{campaign.revision !== null ? ` · rev ${campaign.revision}` : ''}
      </span>
      <span data-testid="campaign-sync" data-phase={campaign.phase} className={`rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tono(campaign)}`}>
        {etiqueta(campaign)}
      </span>

      {campaign.phase === 'conflict' && campaign.conflict && (
        <div data-testid="campaign-conflict" className="basis-full rounded border border-red-900 bg-red-950/30 px-3 py-2 text-[11px] text-red-200">
          <p>
            El servidor tiene la revisión {campaign.conflict.serverRevision} ({fecha(campaign.conflict.serverUpdatedAt)}) y vos editabas sobre la{' '}
            {campaign.conflict.clientRevision}. No se pisó nada: tu versión quedó guardada en este navegador.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Accion
              testId="conflict-recover-server"
              onClick={() => {
                if (window.confirm('Se descartan tus cambios locales y se carga la versión del servidor. ¿Seguir?')) void resolveConflict('server');
              }}
            >
              Recuperar la del servidor
            </Accion>
            <Accion
              testId="conflict-keep-local"
              onClick={() => {
                if (window.confirm(`Tu versión reemplaza a la revisión ${campaign.conflict?.serverRevision} del servidor. ¿Seguir?`)) void resolveConflict('local');
              }}
            >
              Mantener la mía
            </Accion>
            <Accion testId="conflict-duplicate" onClick={() => void resolveConflict('duplicate')}>
              Duplicar la mía como copia
            </Accion>
          </div>
        </div>
      )}

      {campaign.localCopy && (
        <Accion testId="download-local-copy" onClick={() => descargar(`${campaign.localCopy?.id ?? 'draft'}.copia-local.draft.json`, campaign.localCopy)}>
          Descargar copia local
        </Accion>
      )}

      {campaign.phase === 'error' && campaign.error && (
        <p data-testid="campaign-error" className="basis-full text-[11px] text-red-300">
          {campaign.error.message}
          {campaign.revision === null ? ' Lo que edites queda solo en este navegador.' : ''}
        </p>
      )}
    </div>
  );
}

export function etiqueta(c: CampaignView): string {
  switch (c.phase) {
    case 'opening':
      return 'ABRIENDO…';
    case 'saving':
      return 'GUARDANDO…';
    case 'idle':
    case 'saved':
      return 'SINCRONIZADO';
    case 'pending':
      return 'PENDIENTE · SIN CONEXIÓN';
    case 'conflict':
      return 'CONFLICTO';
    case 'error':
      return `ERROR · ${c.error?.code ?? ''}`;
  }
}

function tono(c: CampaignView): string {
  if (c.phase === 'conflict' || c.phase === 'error') return 'border-red-900 bg-red-950/40 text-red-300';
  if (c.phase === 'pending') return 'border-amber-900 bg-amber-950/40 text-amber-400';
  return 'border-neutral-800 bg-neutral-900/60 text-neutral-400';
}

function fecha(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t).toLocaleString();
}

function descargar(nombre: string, datos: unknown) {
  const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

function Accion({ children, onClick, testId }: { children: React.ReactNode; onClick: () => void; testId: string }) {
  return (
    <button data-testid={testId} onClick={onClick} className="rounded border border-neutral-700 px-2.5 py-1 text-[11px] font-medium text-neutral-200 hover:border-neutral-500">
      {children}
    </button>
  );
}
