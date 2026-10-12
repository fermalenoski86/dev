'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { type ActiveVersionChange, type ActiveVersionRequestPayload, type Campaign, PlatformApiError, type Role, type VersionSummary, payloadPedido } from '../lib/api';
import { Intent, type IntentOutcome, trasResultado } from '../lib/intent';
import { todasLasVersiones } from '../lib/version-history';
import { useSession } from './SessionGate';
import { ErrorMessage, describeError } from './ui';

/**
 * F3(a) UI — versión vigente ADMINISTRATIVA de una campaña (brief
 * `docs/briefs/F3A_UI.md`, aprobado en #60).
 *
 *   · Página propia: carga solo campaña, historial de pedidos y versiones
 *     (todas las páginas); nunca `GET /assets`, así funciona para
 *     INTERNAL_APPROVER sin depender de #43.
 *   · Pedir (OPERATOR/ADMIN), confirmar (INTERNAL_APPROVER/ADMIN, nunca quien
 *     pidió) y cancelar (quien pidió o ADMIN). El servidor es la autoridad.
 *   · Cada mutación es una "intención" (`lib/intent.ts`): key y payload
 *     congelados; ante un resultado incierto se reintenta igual.
 *   · Aviso siempre visible: no despliega contenido al edificio.
 */
export const ADMIN_NOTICE = 'Versión vigente administrativa: no despliega contenido al edificio.';

export type OpKind = 'request' | 'confirm' | 'cancel';
export interface OpState {
  phase: 'idle' | 'inflight' | 'uncertain';
  message: string | null;
}
const OP_IDLE: OpState = { phase: 'idle', message: null };

export interface ActiveVersionViewProps {
  me: { id: string; roles: readonly Role[] } | null;
  campaign: Campaign | null;
  loadError: string | null;
  /** Todas las versiones de la campaña (todas las páginas), para numerar y elegir. */
  versions: VersionSummary[];
  history: ActiveVersionChange[] | null;
  historyHasMore: boolean;
  historyMore: { busy: boolean; error: string | null };
  onMoreHistory: () => void;
  form: { versionId: string; reason: string };
  onForm: (patch: Partial<{ versionId: string; reason: string }>) => void;
  confirmOpen: boolean;
  onOpenConfirm: () => void;
  onCloseConfirm: () => void;
  ops: Record<OpKind, OpState>;
  notice: string | null;
  onRequest: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onRetry: (op: OpKind) => void;
  onDiscard: (op: OpKind) => void;
  /** Reloj del navegador, solo para el "vence en ~X" aproximado. */
  now: number;
}

const tiene = (roles: readonly Role[] | undefined, ...r: Role[]) => r.some((x) => roles?.includes(x));

function Quien({ id, meId }: { id: string; meId: string | undefined }) {
  if (id === meId) return <strong>Vos</strong>;
  // id corto a la vista; el completo en `title` y seleccionable (❓3)
  return (
    <code className="hash" title={id} data-full-id={id}>
      {id.slice(0, 8)}
    </code>
  );
}

function venceEn(expiresAt: string, now: number): string {
  const min = Math.round((Date.parse(expiresAt) - now) / 60_000);
  if (Number.isNaN(min)) return '';
  if (min <= 0) return 'vencido según tu reloj (lo decide el servidor)';
  if (min < 60) return `vence en ~${min} min`;
  return `vence en ~${Math.round(min / 60)} h`;
}

function Incierto({ op, state, onRetry, onDiscard }: { op: OpKind; state: OpState; onRetry: (op: OpKind) => void; onDiscard: (op: OpKind) => void }) {
  if (state.phase !== 'uncertain') return null;
  return (
    <div className="card" data-testid={`uncertain-${op}`}>
      <p role="alert" className="error">
        No sabemos si se aplicó. {state.message}
      </p>
      <p>
        <button type="button" onClick={() => onRetry(op)}>
          Reintentar
        </button>{' '}
        <button type="button" onClick={() => onDiscard(op)}>
          Descartar y volver a leer
        </button>
      </p>
    </div>
  );
}

export function ActiveVersionView(p: ActiveVersionViewProps) {
  if (p.loadError) {
    return (
      <main className="page" id="contenido">
        <h1>Versión vigente</h1>
        <p data-testid="admin-notice">
          <strong>{ADMIN_NOTICE}</strong>
        </p>
        <ErrorMessage message={p.loadError} />
      </main>
    );
  }
  const c = p.campaign;
  if (!c || p.history === null) {
    return (
      <main className="page" id="contenido" aria-busy="true">
        <h1>Versión vigente</h1>
        <p data-testid="admin-notice">
          <strong>{ADMIN_NOTICE}</strong>
        </p>
        <p role="status">Cargando versión vigente…</p>
      </main>
    );
  }
  const byId = new Map(p.versions.map((v) => [v.id, v]));
  const num = (id: string | null | undefined) => (id ? (byId.get(id) ? `v${byId.get(id)?.versionNumber}` : 'versión') : 'sin vigente');
  const roles = p.me?.roles;
  const meId = p.me?.id;
  const activa = c.activeVersion ?? null;
  const pend = c.pendingActiveVersionChange ?? null;
  const pendDetalle = pend ? p.history.find((h) => h.id === pend.id) ?? null : null;
  const archivada = c.lifecycleStatus !== 'ACTIVE';
  const propio = !!pend && pend.requestedBy === meId;
  const puedePedir = tiene(roles, 'OPERATOR', 'ADMIN') && !pend && !archivada;
  const puedeConfirmar = !!pend && tiene(roles, 'INTERNAL_APPROVER', 'ADMIN') && !propio;
  const puedeCancelar = !!pend && (propio || tiene(roles, 'ADMIN'));
  const candidatas = p.versions.filter((v) => v.status === 'APPROVED' && v.id !== activa?.id);
  const ocupado = (op: OpKind) => p.ops[op].phase !== 'idle';
  const destino = pend ? byId.get(pend.toVersionId) : undefined;
  const origenId = pendDetalle ? pendDetalle.fromVersionId : activa?.id ?? null;
  const origenHash = origenId ? (byId.get(origenId)?.versionHash ?? (activa?.id === origenId ? activa.versionHash : null)) : null;

  return (
    <main className="page" id="contenido">
      <h1>Versión vigente · {c.name}</h1>
      <p data-testid="admin-notice">
        <strong>{ADMIN_NOTICE}</strong>
      </p>
      {p.notice ? (
        <p role="status" data-testid="active-version-notice">
          {p.notice}
        </p>
      ) : null}

      <section aria-labelledby="vigente" className="card">
        <h2 id="vigente">Vigente</h2>
        <p data-testid="active-version">
          {activa ? (
            <>
              <a href={`/versions/${activa.id}`}>v{activa.versionNumber}</a> · <code className="hash">{activa.versionHash}</code>
            </>
          ) : (
            'Sin versión vigente'
          )}
        </p>
        <p data-testid="latest-approved" className="muted">
          Última aprobada (dato aparte, no es la vigente):{' '}
          {c.latestApprovedVersion ? (
            <>
              v{c.latestApprovedVersion.versionNumber} · <code className="hash">{c.latestApprovedVersion.versionHash}</code>
            </>
          ) : (
            'ninguna'
          )}
        </p>
        {archivada ? <p>La campaña está archivada: su versión vigente no se cambia.</p> : null}
      </section>

      <section aria-labelledby="pendiente" className="card">
        <h2 id="pendiente">Pedido pendiente</h2>
        {!pend ? <p data-testid="no-pending">No hay un pedido pendiente.</p> : null}
        {pend ? (
          <div data-testid="pending">
            <p>
              De <strong>{origenId ? num(origenId) : 'sin vigente'}</strong>
              {origenHash ? (
                <>
                  {' '}
                  (<code className="hash">{origenHash}</code>)
                </>
              ) : null}{' '}
              a <strong>{destino ? `v${destino.versionNumber}` : 'versión'}</strong> (<code className="hash">{pend.toVersionHash}</code>)
            </p>
            {pendDetalle ? <p>Motivo: {pendDetalle.reason}</p> : null}
            <p>
              Pedido por <Quien id={pend.requestedBy} meId={meId} /> el {pend.requestedAt}.
            </p>
            <p>
              Vence: {pend.expiresAt} <span className="muted">({venceEn(pend.expiresAt, p.now)}; aproximado, con el reloj de tu navegador)</span>
            </p>
            {propio && tiene(roles, 'INTERNAL_APPROVER', 'ADMIN') ? <p data-testid="four-eyes-note">Lo tiene que confirmar otra persona.</p> : null}
            {puedeConfirmar && !p.confirmOpen ? (
              <p>
                <button type="button" onClick={p.onOpenConfirm} disabled={ocupado('cancel')}>
                  Revisar y confirmar
                </button>
              </p>
            ) : null}
            {puedeConfirmar && p.confirmOpen ? (
              <div className="card" data-testid="confirm-step">
                <p>
                  Vas a cambiar la vigente de <strong>{origenId ? num(origenId) : 'sin vigente'}</strong>
                  {origenHash ? (
                    <>
                      {' '}
                      (<code className="hash">{origenHash}</code>)
                    </>
                  ) : null}{' '}
                  a <strong>{destino ? `v${destino.versionNumber}` : 'versión'}</strong> (<code className="hash">{pend.toVersionHash}</code>).
                  {pendDetalle ? ` Motivo: ${pendDetalle.reason}` : ''}
                </p>
                <p>
                  <button type="button" onClick={p.onConfirm} disabled={ocupado('confirm')} aria-busy={p.ops.confirm.phase === 'inflight'}>
                    {p.ops.confirm.phase === 'inflight' ? 'Confirmando…' : 'Confirmar cambio'}
                  </button>{' '}
                  <button type="button" onClick={p.onCloseConfirm} disabled={ocupado('confirm')}>
                    Volver
                  </button>
                </p>
              </div>
            ) : null}
            {puedeCancelar ? (
              <p>
                <button type="button" onClick={p.onCancel} disabled={ocupado('cancel') || ocupado('confirm')} aria-busy={p.ops.cancel.phase === 'inflight'}>
                  {p.ops.cancel.phase === 'inflight' ? 'Cancelando…' : 'Cancelar pedido'}
                </button>
              </p>
            ) : null}
          </div>
        ) : null}
        <Incierto op="confirm" state={p.ops.confirm} onRetry={p.onRetry} onDiscard={p.onDiscard} />
        <Incierto op="cancel" state={p.ops.cancel} onRetry={p.onRetry} onDiscard={p.onDiscard} />
        {p.ops.confirm.phase === 'idle' ? <ErrorMessage message={p.ops.confirm.message} /> : null}
        {p.ops.cancel.phase === 'idle' ? <ErrorMessage message={p.ops.cancel.message} /> : null}
      </section>

      {puedePedir || p.ops.request.phase === 'uncertain' ? (
        <form
          className="card"
          aria-labelledby="pedir"
          onSubmit={(e) => {
            e.preventDefault();
            p.onRequest();
          }}
        >
          <h2 id="pedir">Pedir un cambio de versión vigente</h2>
          {candidatas.length === 0 ? <p>No hay otra versión APPROVED para elegir.</p> : null}
          <label>
            Versión aprobada
            <select value={p.form.versionId} onChange={(e) => p.onForm({ versionId: e.target.value })} disabled={ocupado('request')} required>
              <option value="">Elegí una versión</option>
              {candidatas.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.versionNumber} · {v.versionHash.slice(0, 12)}…
                </option>
              ))}
            </select>
          </label>
          <label>
            Motivo
            <textarea value={p.form.reason} onChange={(e) => p.onForm({ reason: e.target.value })} maxLength={2000} required disabled={ocupado('request')} />
          </label>
          <button type="submit" disabled={ocupado('request') || candidatas.length === 0} aria-busy={p.ops.request.phase === 'inflight'}>
            {p.ops.request.phase === 'inflight' ? 'Enviando…' : 'Pedir cambio'}
          </button>
          <Incierto op="request" state={p.ops.request} onRetry={p.onRetry} onDiscard={p.onDiscard} />
          {p.ops.request.phase === 'idle' ? <ErrorMessage message={p.ops.request.message} /> : null}
        </form>
      ) : null}

      <section aria-labelledby="historial-vigente" className="card">
        <h2 id="historial-vigente">Historial de pedidos</h2>
        {p.history.length === 0 ? <p data-testid="history-empty">Todavía no hubo pedidos de cambio.</p> : null}
        {p.history.length > 0 ? (
          <table data-testid="active-history">
            <caption className="sr-only">Pedidos de cambio de versión vigente, del más nuevo al más viejo</caption>
            <thead>
              <tr>
                <th scope="col">Estado</th>
                <th scope="col">Cambio</th>
                <th scope="col">Pidió</th>
                <th scope="col">Decidió</th>
                <th scope="col">Fechas</th>
                <th scope="col">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {p.history.map((h) => (
                <tr key={h.id}>
                  <td>{h.status}</td>
                  <td>
                    {num(h.fromVersionId)} → {num(h.toVersionId)}
                  </td>
                  <td>
                    <Quien id={h.requestedBy} meId={meId} />
                  </td>
                  <td>{h.decidedBy ? <Quien id={h.decidedBy} meId={meId} /> : h.status === 'EXPIRED' ? 'venció' : '—'}</td>
                  <td>
                    {h.requestedAt}
                    {h.decidedAt ? ` → ${h.decidedAt}` : ''}
                  </td>
                  <td>{h.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <ErrorMessage message={p.historyMore.error} />
        {p.historyHasMore ? (
          <button type="button" onClick={p.onMoreHistory} disabled={p.historyMore.busy} aria-busy={p.historyMore.busy}>
            {p.historyMore.busy ? 'Cargando…' : 'Ver pedidos anteriores'}
          </button>
        ) : null}
      </section>
    </main>
  );
}

/** Mensaje para un error definitivo de la API (§4 del brief); el texto del servidor va siempre al final. */
export function mensajeError(op: OpKind, e: unknown): string {
  const base = describeError(e);
  if (!(e instanceof PlatformApiError)) return base;
  switch (e.code) {
    case 'ACTIVE_VERSION_CONFLICT':
      return `La vigente cambió mientras tanto${op === 'confirm' ? ': el pedido quedó cancelado' : ': no se creó ningún pedido'}. ${base}`;
    case 'ACTIVE_VERSION_CHANGE_EXPIRED':
      return `El pedido venció; hay que pedirlo de nuevo. ${base}`;
    case 'ACTIVE_VERSION_CHANGE_PENDING':
      return `Ya hay un pedido pendiente. ${base}`;
    case 'ACTIVE_VERSION_UNCHANGED':
      return `Esa versión ya es la vigente. ${base}`;
    case 'VERSION_HASH_MISMATCH':
      return `La versión cambió desde que la viste; recargá. ${base}`;
    case 'INVALID_STATE_TRANSITION':
      return e.details?.lifecycleStatus ? `La campaña está archivada. ${base}` : `El pedido ya no está pendiente. ${base}`;
    default:
      return base;
  }
}

export function ActiveVersion({ campaignId }: { campaignId: string }) {
  const { client, me } = useSession();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [history, setHistory] = useState<ActiveVersionChange[] | null>(null);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyMore, setHistoryMore] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState({ versionId: '', reason: '' });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [ops, setOps] = useState<Record<OpKind, OpState>>({ request: OP_IDLE, confirm: OP_IDLE, cancel: OP_IDLE });
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Una intención por acción; el payload lo congela `start` (§5).
  const intents = useRef({
    request: new Intent<ActiveVersionRequestPayload, ActiveVersionChange>((pl, key) => client.requestActiveVersionChange(campaignId, pl, key)),
    confirm: new Intent<{ changeId: string; versionHash: string }, ActiveVersionChange>((pl, key) => client.confirmActiveVersionChange(pl.changeId, { versionHash: pl.versionHash }, key)),
    cancel: new Intent<{ changeId: string }, ActiveVersionChange>((pl, key) => client.cancelActiveVersionChange(pl.changeId, key)),
  });

  const cargar = useCallback(async () => {
    try {
      const [c, h, vs] = await Promise.all([
        client.getCampaign(campaignId),
        client.listActiveVersionChanges(campaignId),
        todasLasVersiones((cursor) => client.listCampaignVersions(campaignId, { cursor, limit: 100 })),
      ]);
      setCampaign(c);
      setHistory(h.items);
      setHistoryCursor(h.nextCursor);
      setVersions(vs);
      setLoadError(null);
      setNow(Date.now());
    } catch (e) {
      setLoadError(describeError(e));
    }
  }, [client, campaignId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const resolver = async <R,>(op: OpKind, outcome: IntentOutcome<R>, ok: string) => {
    const paso = trasResultado(outcome.kind);
    if (outcome.kind === 'uncertain') {
      setOps((o) => ({ ...o, [op]: { phase: paso.phase, message: describeError(outcome.error) } }));
    } else {
      setOps((o) => ({ ...o, [op]: { phase: paso.phase, message: outcome.kind === 'definitive-error' ? mensajeError(op, outcome.error) : null } }));
      if (outcome.kind === 'ok') {
        setNotice(ok);
        if (op === 'request') setForm({ versionId: '', reason: '' });
      } else setNotice(null);
      setConfirmOpen(false);
    }
    if (paso.recargar) await cargar(); // tras un resultado definitivo, siempre se vuelve a leer
  };

  const correr = async <R,>(op: OpKind, run: () => Promise<IntentOutcome<R>>, ok: string) => {
    if (ops[op].phase === 'inflight') return;
    setOps((o) => ({ ...o, [op]: { phase: 'inflight', message: null } }));
    let outcome: IntentOutcome<R>;
    try {
      outcome = await run();
    } catch (e) {
      setOps((o) => ({ ...o, [op]: { phase: 'idle', message: describeError(e) } }));
      return;
    }
    await resolver(op, outcome, ok);
  };

  const OK: Record<OpKind, string> = {
    request: 'Pedido creado: lo tiene que confirmar otra persona.',
    confirm: 'Cambio confirmado: la versión vigente cambió.',
    cancel: 'Pedido cancelado.',
  };

  const onRequest = () => {
    const v = versions.find((x) => x.id === form.versionId);
    if (!v || !campaign) return;
    // payload congelado con lo que la página MUESTRA (expectedActiveVersionId incluido)
    const payload: ActiveVersionRequestPayload = payloadPedido(campaign, v, form.reason);
    void correr('request', () => intents.current.request.start(payload), OK.request);
  };
  const onConfirm = () => {
    const pend = campaign?.pendingActiveVersionChange;
    if (!pend) return;
    void correr('confirm', () => intents.current.confirm.start({ changeId: pend.id, versionHash: pend.toVersionHash }), OK.confirm);
  };
  const onCancel = () => {
    const pend = campaign?.pendingActiveVersionChange;
    if (!pend) return;
    void correr('cancel', () => intents.current.cancel.start({ changeId: pend.id }), OK.cancel);
  };
  const onRetry = (op: OpKind) => {
    // misma key y mismo payload: nada se reconstruye desde un GET nuevo
    void correr(op, () => intents.current[op].retry(), OK[op]);
  };
  const onDiscard = (op: OpKind) => {
    intents.current[op].discard();
    setOps((o) => ({ ...o, [op]: OP_IDLE }));
    setConfirmOpen(false);
    void cargar();
  };

  const onMoreHistory = async () => {
    if (!historyCursor || historyMore.busy) return;
    setHistoryMore({ busy: true, error: null });
    try {
      const pg = await client.listActiveVersionChanges(campaignId, { cursor: historyCursor });
      setHistory((prev) => [...(prev ?? []), ...pg.items.filter((x) => !(prev ?? []).some((y) => y.id === x.id))]);
      setHistoryCursor(pg.nextCursor);
      setHistoryMore({ busy: false, error: null });
    } catch (e) {
      setHistoryMore({ busy: false, error: describeError(e) });
    }
  };

  return (
    <ActiveVersionView
      me={me ? { id: me.user.id, roles: me.roles } : null}
      campaign={campaign}
      loadError={loadError}
      versions={versions}
      history={history}
      historyHasMore={historyCursor !== null}
      historyMore={historyMore}
      onMoreHistory={() => void onMoreHistory()}
      form={form}
      onForm={(patch) => setForm((f) => ({ ...f, ...patch }))}
      confirmOpen={confirmOpen}
      onOpenConfirm={() => setConfirmOpen(true)}
      onCloseConfirm={() => setConfirmOpen(false)}
      ops={ops}
      notice={notice}
      onRequest={onRequest}
      onConfirm={onConfirm}
      onCancel={onCancel}
      onRetry={onRetry}
      onDiscard={onDiscard}
      now={now}
    />
  );
}
