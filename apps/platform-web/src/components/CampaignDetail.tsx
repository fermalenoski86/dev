'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Asset, Campaign, Draft, ShowVersion } from '../lib/api';
import { builderUrlFor } from '../lib/config';
import { type DraftSlot, DRAFT_SLOTS, SLOT_LABEL, SURFACE_TYPES, draftSlots, slotForAsset, withSlotAsset } from '../lib/draft-assets';
import { useSession } from './SessionGate';
import { ErrorMessage, describeError } from './ui';

export interface CampaignDetailViewProps {
  campaign: Campaign | null;
  draft: Draft | null;
  assets: Asset[];
  builderUrl: string | null;
  loadError: string | null;
  upload: { surfaceType: string; fileName: string | null; busy: boolean; error: string | null; last: Asset | null };
  assign: { busy: boolean; error: string | null };
  submit: { busy: boolean; error: string | null; version: ShowVersion | null };
  onSurfaceType: (v: string) => void;
  onFile: (f: File | null) => void;
  onUpload: () => void;
  onAssign: (slot: DraftSlot, assetId: string) => void;
  onSubmit: () => void;
}

const corto = (h: string | null) => (h ? h : '—');

/** Detalle de campaña (E3b, §32): versión aprobada y working draft separados, assets, envío. */
export function CampaignDetailView(p: CampaignDetailViewProps) {
  if (p.loadError) {
    return (
      <main className="page" id="contenido">
        <ErrorMessage message={p.loadError} />
      </main>
    );
  }
  if (!p.campaign || !p.draft) {
    return (
      <main className="page" id="contenido" aria-busy="true">
        <p role="status">Cargando campaña…</p>
      </main>
    );
  }
  const c = p.campaign;
  const slots = draftSlots(p.draft.takeoverDraft);
  const nombreAsset = (id: string | null) => {
    if (!id) return 'sin asignar';
    const a = p.assets.find((x) => x.id === id);
    return a ? `${a.originalFilename} · ${corto(a.sha256)}` : id;
  };
  const versionCreada = p.submit.version;

  return (
    <main className="page" id="contenido">
      <h1>{c.name}</h1>
      <section aria-labelledby="estado-version" className="card">
        <h2 id="estado-version">Versión aprobada y working draft</h2>
        <p data-testid="approved-version">
          {c.latestApprovedVersion ? (
            <>
              <strong>APPROVED VERSION v{c.latestApprovedVersion.versionNumber}</strong> · hash <code className="hash">{c.latestApprovedVersion.versionHash}</code>
            </>
          ) : (
            <strong>Sin versión aprobada</strong>
          )}
        </p>
        <p data-testid="working-draft">
          <strong>WORKING DRAFT</strong> · rev {p.draft.revision} · actualizado {p.draft.updatedAt}
        </p>
        {p.builderUrl ? (
          <p>
            <a href={p.builderUrl}>Editar el draft en el Builder</a>
          </p>
        ) : (
          <p className="muted">El enlace al Builder requiere NEXT_PUBLIC_TRUST_BUILDER_URL.</p>
        )}
      </section>

      <section aria-labelledby="ranuras" className="card">
        <h2 id="ranuras">Assets del draft</h2>
        <table>
          <caption className="sr-only">Asset asignado a cada superficie del draft</caption>
          <thead>
            <tr>
              <th scope="col">Superficie</th>
              <th scope="col">Asset asignado</th>
            </tr>
          </thead>
          <tbody>
            {DRAFT_SLOTS.map((s) => (
              <tr key={s}>
                <td>{SLOT_LABEL[s]}</td>
                <td>{nombreAsset(slots[s])}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ErrorMessage message={p.assign.error} />
      </section>

      <section aria-labelledby="assets" className="card">
        <h2 id="assets">Mis assets</h2>
        <form
          aria-labelledby="subir-asset"
          onSubmit={(e) => {
            e.preventDefault();
            p.onUpload();
          }}
        >
          <h3 id="subir-asset">Subir un video</h3>
          <label htmlFor="asset-surface">Superficie</label>
          <select id="asset-surface" value={p.upload.surfaceType} onChange={(e) => p.onSurfaceType(e.target.value)}>
            {SURFACE_TYPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <label htmlFor="asset-file">Archivo MP4</label>
          <input id="asset-file" type="file" accept="video/mp4" onChange={(e) => p.onFile(e.target.files?.[0] ?? null)} />
          <ErrorMessage message={p.upload.error} />
          {p.upload.last ? (
            <p role="status" data-testid="upload-result">
              {p.upload.last.status === 'READY'
                ? `«${p.upload.last.originalFilename}» READY · SHA-256 ${corto(p.upload.last.sha256)}`
                : `«${p.upload.last.originalFilename}» REJECTED · ${p.upload.last.rejection?.message ?? ''}`}
            </p>
          ) : null}
          <button type="submit" disabled={p.upload.busy || !p.upload.fileName} aria-busy={p.upload.busy}>
            {p.upload.busy ? 'Subiendo y validando…' : 'Subir'}
          </button>
        </form>
        {p.assets.length === 0 ? <p>Todavía no subiste assets.</p> : null}
        {p.assets.length > 0 ? (
          <table>
            <caption className="sr-only">Assets subidos por tu usuario</caption>
            <thead>
              <tr>
                <th scope="col">Archivo</th>
                <th scope="col">Superficie</th>
                <th scope="col">Estado</th>
                <th scope="col">SHA-256</th>
                <th scope="col">Acción</th>
              </tr>
            </thead>
            <tbody>
              {p.assets.map((a) => {
                const slot = slotForAsset(a);
                const yaAsignado = slot !== null && slots[slot] === a.id;
                return (
                  <tr key={a.id}>
                    <td>{a.originalFilename}</td>
                    <td>{a.surfaceType}</td>
                    <td>
                      {a.status}
                      {a.status === 'READY' && a.width && a.height ? ` · ${a.width}×${a.height}${a.fps ? ` · ${a.fps} fps` : ''}${a.codec ? ` · ${a.codec}` : ''}` : null}
                      {a.rejection ? (
                        <>
                          <br />
                          {a.rejection.code}: {a.rejection.message}
                          <br />
                          <span className="muted">{a.rejection.remediation.summary}</span>
                        </>
                      ) : null}
                    </td>
                    <td>
                      <code className="hash">{corto(a.sha256)}</code>
                    </td>
                    <td>
                      {slot ? (
                        <button type="button" disabled={p.assign.busy || yaAsignado} onClick={() => p.onAssign(slot, a.id)}>
                          {yaAsignado ? `Asignado a ${SLOT_LABEL[slot]}` : `Usar en ${SLOT_LABEL[slot]}`}
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </section>

      <section aria-labelledby="enviar" className="card">
        <h2 id="enviar">Enviar a aprobación</h2>
        <p>
          Se envía el WORKING DRAFT rev {p.draft.revision}. El servidor recompila, corre el preflight y crea una versión inmutable con su hash.
        </p>
        <ErrorMessage message={p.submit.error} />
        {versionCreada ? (
          <div role="status" data-testid="submitted-version">
            <p>
              Versión v{versionCreada.versionNumber} enviada ({versionCreada.status}) · hash <code className="hash">{versionCreada.versionHash}</code>
            </p>
            <p>
              Enlace para revisión: <a href={`/versions/${versionCreada.id}`}>/versions/{versionCreada.id}</a>
            </p>
          </div>
        ) : null}
        <button type="button" onClick={p.onSubmit} disabled={p.submit.busy} aria-busy={p.submit.busy}>
          {p.submit.busy ? 'Enviando…' : `Enviar rev ${p.draft.revision} a aprobación`}
        </button>
      </section>
    </main>
  );
}

export function CampaignDetail({ campaignId }: { campaignId: string }) {
  const { client } = useSession();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [surfaceType, setSurfaceType] = useState<string>(SURFACE_TYPES[0]);
  const [file, setFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<{ busy: boolean; error: string | null; last: Asset | null }>({ busy: false, error: null, last: null });
  const [assign, setAssign] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const [submit, setSubmit] = useState<{ busy: boolean; error: string | null; version: ShowVersion | null }>({ busy: false, error: null, version: null });

  const cargar = useCallback(async () => {
    try {
      const [c, d, as] = await Promise.all([client.getCampaign(campaignId), client.getDraft(campaignId), client.listAssets()]);
      setCampaign(c);
      setDraft(d);
      setAssets(as);
      setLoadError(null);
    } catch (e) {
      setLoadError(describeError(e));
    }
  }, [client, campaignId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const onUpload = async () => {
    if (!file || upload.busy) return;
    setUpload({ busy: true, error: null, last: null });
    try {
      const a = await client.uploadAsset({ surfaceType, file, filename: file.name });
      setUpload({ busy: false, error: null, last: a });
      setAssets(await client.listAssets());
    } catch (e) {
      setUpload({ busy: false, error: describeError(e), last: null });
    }
  };

  const onAssign = async (slot: DraftSlot, assetId: string) => {
    if (!draft || assign.busy) return;
    setAssign({ busy: true, error: null });
    try {
      // siempre sobre el draft que el servidor tiene ahora; un 409 no pisa al Builder
      const actual = await client.getDraft(campaignId);
      const d = await client.putDraft(campaignId, { takeoverDraft: withSlotAsset(actual.takeoverDraft, slot, assetId), expectedRevision: actual.revision });
      setDraft(d);
      setAssign({ busy: false, error: null });
    } catch (e) {
      setAssign({ busy: false, error: describeError(e) });
    }
  };

  const onSubmit = async () => {
    if (!draft || submit.busy) return;
    setSubmit({ busy: true, error: null, version: null });
    try {
      const v = await client.submit(campaignId, draft.revision);
      setSubmit({ busy: false, error: null, version: v });
      setCampaign(await client.getCampaign(campaignId));
    } catch (e) {
      setSubmit({ busy: false, error: describeError(e), version: null });
    }
  };

  return (
    <CampaignDetailView
      campaign={campaign}
      draft={draft}
      assets={assets}
      builderUrl={builderUrlFor(campaignId)}
      loadError={loadError}
      upload={{ surfaceType, fileName: file?.name ?? null, ...upload }}
      assign={assign}
      submit={submit}
      onSurfaceType={setSurfaceType}
      onFile={setFile}
      onUpload={() => void onUpload()}
      onAssign={(s, id) => void onAssign(s, id)}
      onSubmit={() => void onSubmit()}
    />
  );
}
