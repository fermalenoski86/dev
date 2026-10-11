'use client';

import { useCallback, useEffect, useState } from 'react';
import type { VersionSummary } from '../lib/api';
import { appendPage } from '../lib/version-history';
import { useSession } from './SessionGate';
import { ErrorMessage, describeError } from './ui';

export interface CampaignVersionsViewProps {
  campaignId: string;
  /** null = todavía cargando la primera página. */
  items: VersionSummary[] | null;
  hasMore: boolean;
  loadError: string | null;
  more: { busy: boolean; error: string | null };
  onMore: () => void;
}

/**
 * BL-31 · historial de versiones de una campaña (más nueva primero). Cada fila
 * lleva a la revisión de esa versión; el estado va en texto, no solo en color.
 * Qué versiones se ven lo decide el servidor (404 si la campaña está fuera de scope).
 */
export function CampaignVersionsView(p: CampaignVersionsViewProps) {
  if (p.loadError) {
    return (
      <main className="page" id="contenido">
        <h1>Historial de versiones</h1>
        <ErrorMessage message={p.loadError} />
      </main>
    );
  }
  if (p.items === null) {
    return (
      <main className="page" id="contenido" aria-busy="true">
        <h1>Historial de versiones</h1>
        <p role="status">Cargando historial…</p>
      </main>
    );
  }
  return (
    <main className="page" id="contenido">
      <h1>Historial de versiones</h1>
      <section aria-labelledby="historial" className="card">
        <h2 id="historial">Versiones enviadas</h2>
        {p.items.length === 0 ? <p data-testid="versions-empty">La campaña todavía no tiene versiones enviadas.</p> : null}
        {p.items.length > 0 ? (
          <table data-testid="versions-table">
            <caption className="sr-only">Versiones de la campaña, de la más nueva a la más vieja</caption>
            <thead>
              <tr>
                <th scope="col">Versión</th>
                <th scope="col">Estado</th>
                <th scope="col">Hash (sha256)</th>
                <th scope="col">Enviada</th>
                <th scope="col">Draft</th>
              </tr>
            </thead>
            <tbody>
              {p.items.map((v) => (
                <tr key={v.id}>
                  <td>
                    <a href={`/versions/${v.id}`}>v{v.versionNumber}</a>
                  </td>
                  <td>{v.status}</td>
                  <td>
                    <code className="hash">{v.versionHash}</code>
                  </td>
                  <td>{v.submittedAt}</td>
                  <td>rev {v.sourceDraftRevision}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <ErrorMessage message={p.more.error} />
        {p.hasMore ? (
          <button type="button" onClick={p.onMore} disabled={p.more.busy} aria-busy={p.more.busy}>
            {p.more.busy ? 'Cargando…' : 'Ver versiones anteriores'}
          </button>
        ) : null}
      </section>
    </main>
  );
}

export function CampaignVersions({ campaignId }: { campaignId: string }) {
  const { client } = useSession();
  const [items, setItems] = useState<VersionSummary[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [more, setMore] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  const cargar = useCallback(async () => {
    try {
      const p = await client.listCampaignVersions(campaignId);
      setItems(p.items);
      setCursor(p.nextCursor);
      setLoadError(null);
    } catch (e) {
      setLoadError(describeError(e));
    }
  }, [client, campaignId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const onMore = async () => {
    if (!cursor || more.busy) return;
    setMore({ busy: true, error: null });
    try {
      const p = await client.listCampaignVersions(campaignId, { cursor });
      setItems((prev) => appendPage(prev ?? [], p.items));
      setCursor(p.nextCursor);
      setMore({ busy: false, error: null });
    } catch (e) {
      setMore({ busy: false, error: describeError(e) });
    }
  };

  return <CampaignVersionsView campaignId={campaignId} items={items} hasMore={cursor !== null} loadError={loadError} more={more} onMore={() => void onMore()} />;
}
