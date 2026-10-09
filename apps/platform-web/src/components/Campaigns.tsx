'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Campaign, Contract } from '../lib/api';
import { useSession } from './SessionGate';
import { ErrorMessage, describeError } from './ui';

export interface CampaignsViewProps {
  campaigns: Campaign[] | null;
  contracts: Contract[];
  loadError: string | null;
  form: { contractId: string; name: string; submitting: boolean; error: string | null; created: string | null };
  onContract: (id: string) => void;
  onName: (v: string) => void;
  onCreate: () => void;
}

/**
 * Lista y alta de campañas (E3a). Cada rol ve lo que la API le devuelve; si un
 * rol no puede crear, el 403 del servidor se muestra tal cual (la UI no
 * reimplementa permisos).
 */
export function CampaignsView(p: CampaignsViewProps) {
  const nombreContrato = (id: string) => p.contracts.find((c) => c.id === id)?.name ?? id;
  return (
    <main className="page" id="contenido">
      <h1>Campañas</h1>
      <ErrorMessage message={p.loadError} />
      {p.campaigns === null && !p.loadError ? <p role="status">Cargando campañas…</p> : null}
      {p.campaigns && p.campaigns.length === 0 ? <p>Todavía no hay campañas.</p> : null}
      {p.campaigns && p.campaigns.length > 0 ? (
        <table>
          <caption className="sr-only">Campañas visibles para tu usuario</caption>
          <thead>
            <tr>
              <th scope="col">Campaña</th>
              <th scope="col">Contrato</th>
              <th scope="col">Working draft</th>
              <th scope="col">Versión aprobada</th>
            </tr>
          </thead>
          <tbody>
            {p.campaigns.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{nombreContrato(c.contractId)}</td>
                <td>{c.currentDraft ? `rev ${c.currentDraft.revision}` : '—'}</td>
                <td>
                  {c.latestApprovedVersion ? (
                    <>
                      APPROVED VERSION v{c.latestApprovedVersion.versionNumber} · <code className="hash">{c.latestApprovedVersion.versionHash}</code>
                    </>
                  ) : (
                    'sin versión aprobada'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <form
        className="card"
        aria-labelledby="nueva-campana"
        onSubmit={(e) => {
          e.preventDefault();
          p.onCreate();
        }}
      >
        <h2 id="nueva-campana">Nueva campaña</h2>
        <label htmlFor="campaign-contract">Contrato</label>
        <select id="campaign-contract" required value={p.form.contractId} onChange={(e) => p.onContract(e.target.value)}>
          <option value="">Elegí un contrato…</option>
          {p.contracts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.status})
            </option>
          ))}
        </select>
        <label htmlFor="campaign-name">Nombre</label>
        <input id="campaign-name" required maxLength={200} value={p.form.name} onChange={(e) => p.onName(e.target.value)} />
        <ErrorMessage message={p.form.error} />
        {p.form.created ? <p role="status">Campaña «{p.form.created}» creada.</p> : null}
        <button type="submit" disabled={p.form.submitting || !p.form.contractId || !p.form.name.trim()} aria-busy={p.form.submitting}>
          {p.form.submitting ? 'Creando…' : 'Crear campaña'}
        </button>
      </form>
    </main>
  );
}

export function Campaigns() {
  const { client } = useSession();
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [contractId, setContractId] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [cs, ks] = await Promise.all([client.listCampaigns(), client.listContracts()]);
      setCampaigns(cs);
      setContracts(ks);
      setLoadError(null);
    } catch (e) {
      setLoadError(describeError(e));
    }
  }, [client]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const onCreate = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setCreated(null);
    try {
      const c = await client.createCampaign({ contractId, name: name.trim() });
      setCreated(c.name);
      setName('');
      await cargar();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <CampaignsView
      campaigns={campaigns}
      contracts={contracts}
      loadError={loadError}
      form={{ contractId, name, submitting, error, created }}
      onContract={setContractId}
      onName={setName}
      onCreate={() => void onCreate()}
    />
  );
}
